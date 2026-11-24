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
export declare class PrivateVaultUnavailableError extends Error {
    code: string;
    constructor(message?: string);
}
/** OS credential-store adapter. Secrets travel on stdin/stdout, never argv. */
export declare function platformKeyring(account?: string): PrivateVaultKeyring | null;
export declare class PrivateVault {
    private readonly options;
    private masterKey;
    private readonly keyring;
    private readonly random;
    constructor(options?: PrivateVaultOptions);
    private unlock;
    /** Returns a per-package key; callers must zero it after handing it to SQLCipher. */
    keyFor(packageName: string): Promise<Buffer>;
}
/**
 * Opens an encrypted SQLite database using the SQLCipher compatibility mode.
 * `key` is wiped before this function returns; SQLCipher retains it natively.
 */
export declare function openSqlCipherDatabase(databasePath: string, key: Buffer): any;
