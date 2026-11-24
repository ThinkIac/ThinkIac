export interface CpuPoolOptions {
    size?: number;
    maxQueue?: number;
    taskTimeoutMs?: number;
}
export interface CpuTaskOptions {
    exportName?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
}
export declare class CpuQueueFullError extends Error {
    readonly capacity: number;
    code: string;
    constructor(capacity: number);
}
export declare class CpuTaskTimeoutError extends Error {
    readonly timeoutMs: number;
    code: string;
    constructor(timeoutMs: number);
}
/** Bounded pool for trusted, CPU-bound modules. Workers are reused; overload is rejected. */
export declare class CpuWorkerPool {
    private readonly size;
    private readonly maxQueue;
    private readonly taskTimeoutMs;
    private slots;
    private queue;
    private sequence;
    private closed;
    private totals;
    constructor(options?: CpuPoolOptions);
    run<T = any>(modulePath: string, args?: any[], options?: CpuTaskOptions): Promise<T>;
    snapshot(): {
        submitted: number;
        completed: number;
        failed: number;
        rejected: number;
        timedOut: number;
        cancelled: number;
        size: number;
        running: number;
        queued: number;
        maxQueue: number;
    };
    close(): Promise<void>;
    private createSlot;
    private assign;
    private onMessage;
    private cancel;
    private replace;
    private drain;
    private finishTask;
}
