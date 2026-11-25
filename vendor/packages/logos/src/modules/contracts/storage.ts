import { Container, LogosModule } from '../../kernel/container';
export type StorageState = 'hot' | 'pending' | 'syncing' | 'frozen' | 'restoring' | 'degraded' | 'failed';
export interface StorageRecord {
    path: string;
    key: string;
    sha256: string;
    size: number;
    state: StorageState;
    local: boolean;
    updatedAt: string;
    lastError?: string;
}
export interface StorageProvider {
    name: string;
    /** Resolves only after the remote object was read back/HEAD-checked by hash. */
    put(input: {
        key: string;
        file: string;
        sha256: string;
        size: number;
    }): Promise<{
        sha256: string;
    }>;
    get(input: {
        key: string;
    }): Promise<Buffer>;
}
export interface StorageMeshOptions {
    /** Root used to create stable object keys. */
    root: string;
    /** Durable catalogue/outbox location. Defaults to <root>/.logos/storage. */
    dataDir?: string;
    provider?: StorageProvider;
    retryAfterMs?: number;
}
type StorageEvent = (event: string, payload: Record<string, any>) => void | Promise<void>;
export declare class StorageUnavailableError extends Error {
    code: string;
    retryAfterMs: number;
    constructor(message: string, retryAfterMs: number);
}
export declare class StorageMesh {
    private readonly root;
    private readonly dataFile;
    private provider?;
    private readonly retryAfterMs;
    private state;
    private listeners;
    constructor(options: StorageMeshOptions);
    onEvent(listener: StorageEvent): () => void;
    setProvider(provider?: StorageProvider): void;
    status(file: string): StorageRecord;
    outbox(): string[];
    track(file: string): Promise<StorageRecord>;
    sync(): Promise<void>;
    freeze(file: string): Promise<StorageRecord>;
    ensure(file: string): Promise<StorageRecord>;
    private persist;
    private emit;
}
export declare function getStorage(container: Container): StorageMesh | undefined;
export declare const storageModule: LogosModule;
export {};
