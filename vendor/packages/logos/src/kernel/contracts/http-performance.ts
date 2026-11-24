/** Bounded, in-memory observations. No URLs, request bodies or identities are retained. */
export declare class HttpPerformance {
    private routes;
    private delay;
    private started;
    constructor();
    close(): void;
    middleware: (req: any, res: any, next: any) => void;
    snapshot(): {
        since: string;
        sampleWindow: number;
        memory: NodeJS.MemoryUsage;
        cpu: NodeJS.CpuUsage;
        eventLoop: {
            p95Ms: number;
            p99Ms: number;
        };
        routes: {
            route: string;
            count: number;
            errors: number;
            aborted: number;
            p50Ms: number;
            p95Ms: number;
            p99Ms: number;
            phases: {
                [k: string]: {
                    p95Ms: number;
                };
            };
        }[];
    };
}
export declare function setPerformanceRoute(req: any, route: string): void;
export declare function recordPhase(req: any, name: string, start: number): void;
export declare function measurePhase<T>(req: any, name: string, fn: () => T | Promise<T>): Promise<T>;
