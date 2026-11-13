'use strict';

import { execFile, spawn } from 'node:child_process';
import { hkdfSync, randomBytes as nodeRandomBytes, scryptSync } from 'node:crypto';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SERVICE = 'logos.private-vault.v1';
const MASTER_KEY_BYTES = 32;

export interface PrivateVaultKeyring {
  get(): Promise<Buffer | null>;
  set(value: Buffer): Promise<void>;
}

export interface PrivateVaultOptions {
  /** Host-provided unlock hook. Its return value is never persisted by Lógos. */
  masterKeyProvider?: () => Promise<Buffer | Uint8Array | string | null | undefined>;
  /** Interactive/offline fallback. The password is KDF'd in memory only. */
  passwordProvider?: () => Promise<string | null | undefined>;
  /** Injectable for hosts and tests; defaults to the platform credential store. */
  keyring?: PrivateVaultKeyring | null;
  randomBytes?: (size: number) => Buffer;
}

export class PrivateVaultUnavailableError extends Error {
  code = 'PRIVATE_VAULT_UNAVAILABLE';
  constructor(message = 'Private database requires an OS keyring or an explicit in-memory unlock provider') {
    super(message);
    this.name = 'PrivateVaultUnavailableError';
  }
}

function keyMaterial(value: Buffer | Uint8Array | string): Buffer {
  const output = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
  if (output.length < MASTER_KEY_BYTES) throw new PrivateVaultUnavailableError('Private vault master key must contain at least 32 bytes');
  return output;
}

function execWithStdin(command: string, args: string[], input: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(stderr.trim() || `${command} exited with ${code}`)));
    child.stdin.end(input);
  });
}

/** OS credential-store adapter. Secrets travel on stdin/stdout, never argv. */
export function platformKeyring(account = 'default'): PrivateVaultKeyring | null {
  if (process.platform === 'darwin') return {
    async get() {
      try {
        const { stdout } = await execFileAsync('security', ['find-generic-password', '-w', '-s', SERVICE, '-a', account]);
        return Buffer.from(stdout.trim(), 'base64');
      } catch { return null; }
    },
    async set(value) {
      await execFileAsync('security', ['add-generic-password', '-U', '-s', SERVICE, '-a', account, '-w', value.toString('base64')]);
    },
  };
  if (process.platform === 'linux') return {
    async get() {
      try {
        const { stdout } = await execFileAsync('secret-tool', ['lookup', 'service', SERVICE, 'account', account]);
        return Buffer.from(stdout.trim(), 'base64');
      } catch { return null; }
    },
    async set(value) {
      await execWithStdin('secret-tool', ['store', '--label=Lógos private vault', 'service', SERVICE, 'account', account], value.toString('base64'));
    },
  };
  // A portable runtime cannot silently emulate DPAPI with a plaintext file.
  // Windows hosts must supply a DPAPI-backed keyring adapter until one is bundled.
  return null;
}

export class PrivateVault {
  private masterKey: Buffer | null = null;
  private readonly keyring: PrivateVaultKeyring | null;
  private readonly random: (size: number) => Buffer;

  constructor(private readonly options: PrivateVaultOptions = {}) {
    this.keyring = options.keyring === undefined ? platformKeyring() : options.keyring;
    this.random = options.randomBytes ?? nodeRandomBytes;
  }

  private async unlock(): Promise<Buffer> {
    if (this.masterKey) return this.masterKey;
    const supplied = await this.options.masterKeyProvider?.();
    if (supplied) return this.masterKey = keyMaterial(supplied);

    const fromKeyring = await this.keyring?.get();
    if (fromKeyring?.length) return this.masterKey = keyMaterial(fromKeyring);

    const password = await this.options.passwordProvider?.();
    if (password) {
      // No salt/key material is persisted in this path. The caller owns prompting.
      return this.masterKey = scryptSync(password, SERVICE, MASTER_KEY_BYTES, { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
    }

    if (!this.keyring) throw new PrivateVaultUnavailableError();
    const generated = this.random(MASTER_KEY_BYTES);
    try {
      await this.keyring.set(generated);
      return this.masterKey = Buffer.from(generated);
    } catch (error: any) {
      generated.fill(0);
      throw new PrivateVaultUnavailableError(`OS keyring could not store the private vault key: ${error?.message ?? 'unknown error'}`);
    }
  }

  /** Returns a per-package key; callers must zero it after handing it to SQLCipher. */
  async keyFor(packageName: string): Promise<Buffer> {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(packageName)) throw new TypeError('Private vault package name is invalid');
    const master = await this.unlock();
    return Buffer.from(hkdfSync('sha256', master, Buffer.from(SERVICE), Buffer.from(`package:${packageName}`), MASTER_KEY_BYTES));
  }
}

/**
 * Opens an encrypted SQLite database using the SQLCipher compatibility mode.
 * `key` is wiped before this function returns; SQLCipher retains it natively.
 */
export function openSqlCipherDatabase(databasePath: string, key: Buffer): any {
  let database: any;
  try {
    // The native module is deliberately loaded only for private tenants, so
    // ordinary packages keep the existing Scriba/better-sqlite3 dependency.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3-multiple-ciphers');
    database = new Database(databasePath);
    database.pragma("cipher = 'sqlcipher'");
    database.pragma('legacy = 4');
    if (typeof database.key !== 'function') throw new Error('SQLCipher driver does not expose key(Buffer)');
    database.key(key);
    database.pragma('kdf_iter = 256000');
    database.pragma('cipher_memory_security = ON');
    database.pragma('secure_delete = ON');
    // Forces key verification before the caller can create/use tables.
    database.prepare('SELECT count(*) AS count FROM sqlite_master').get();
    return database;
  } catch (error) {
    try { database?.close(); } catch { /* best effort */ }
    throw error;
  } finally {
    key.fill(0);
  }
}
