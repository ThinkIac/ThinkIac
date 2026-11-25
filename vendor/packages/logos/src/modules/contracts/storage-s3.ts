import { StorageProvider } from './storage';
type S3Fetch = (input: string | URL, init?: any) => Promise<any>;
export interface S3StorageOptions {
    name?: string;
    endpoint: string;
    region?: string;
    bucket: string;
    prefix?: string;
    accessKeyId: string;
    secretAccessKey: string;
    fetch?: S3Fetch;
}
/** A minimal, path-style SigV4 client for immutable blobs and HEAD checks. */
export declare class S3StorageProvider implements StorageProvider {
    readonly name: string;
    private readonly endpoint;
    private readonly region;
    private readonly bucket;
    private readonly prefix;
    private readonly accessKeyId;
    private readonly secretAccessKey;
    private readonly fetchImpl;
    constructor(options: S3StorageOptions);
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
    /** Health probe used by setup flows; does not list or expose tenant data. */
    check(): Promise<void>;
    private objectPath;
    private bucketPath;
    private request;
}
export {};
