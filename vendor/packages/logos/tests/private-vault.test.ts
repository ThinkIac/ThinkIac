import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PrivateVault, PrivateVaultUnavailableError, openSqlCipherDatabase } from '../src/vault/private-vault';

describe('PrivateVault', () => {
  it('derives stable, distinct SQLCipher keys without exposing the master key', async () => {
    const masterKey = Buffer.alloc(32, 7);
    const vault = new PrivateVault({ masterKeyProvider: async () => masterKey });

    const walletFirst = await vault.keyFor('wallet');
    const walletSecond = await vault.keyFor('wallet');
    const agenda = await vault.keyFor('agenda');

    expect(walletFirst.equals(walletSecond)).toBe(true);
    expect(walletFirst.equals(agenda)).toBe(false);
    expect(walletFirst.equals(masterKey)).toBe(false);
    expect(walletFirst).toHaveLength(32);
  });

  it('fails closed when neither an OS keyring nor an explicit unlock provider is available', async () => {
    const vault = new PrivateVault({ keyring: null });
    await expect(vault.keyFor('wallet')).rejects.toBeInstanceOf(PrivateVaultUnavailableError);
  });

  it('never persists a password-derived master key through the fallback path', async () => {
    let writes = 0;
    const vault = new PrivateVault({
      passwordProvider: async () => 'correct horse battery staple',
      keyring: { get: async () => null, set: async () => { writes += 1; } },
      randomBytes: size => Buffer.alloc(size, 9),
    });

    await vault.keyFor('wallet');
    expect(writes).toBe(0);
  });

  it('creates a SQLCipher database that cannot be read as plaintext SQLite', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-private-vault-'));
    const databasePath = path.join(root, 'vault.db');
    try {
      const first = openSqlCipherDatabase(databasePath, Buffer.alloc(32, 4));
      first.exec('CREATE TABLE secret (value TEXT); INSERT INTO secret VALUES (\'encrypted\');');
      first.close();

      expect(fs.readFileSync(databasePath).subarray(0, 16).toString('utf8')).not.toBe('SQLite format 3\u0000');
      const reopened = openSqlCipherDatabase(databasePath, Buffer.alloc(32, 4));
      expect(reopened.prepare('SELECT value FROM secret').get()).toEqual({ value: 'encrypted' });
      reopened.close();
      expect(() => openSqlCipherDatabase(databasePath, Buffer.alloc(32, 5))).toThrow();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
