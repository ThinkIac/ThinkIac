import type { Container } from '../../kernel/container';
export type HealthStatus = 'unknown' | 'healthy' | 'degraded' | 'unhealthy' | 'recovering' | 'quarantined';
export interface PackageHealth {
    status: HealthStatus;
    since: number;
    lastProbeAt: number | null;
    consecutiveFailures: number;
    consecutiveSuccesses: number;
    reason: string | null;
}
export interface MonitorConfig {
    route: string;
    interval: number;
    timeout: number;
    initialDelay: number;
    failureThreshold: number;
    successThreshold: number;
    recovery: 'report' | 'reload' | 'stop';
    maxRecoveries: number;
    recoveryWindow: number;
    cooldown: number;
}
export declare function normalizeMonitor(value: any): MonitorConfig | null;
/** Persist only runtime-owned reason codes, never arbitrary response/error text. */
export declare function normalizeHealth(code: number, body: any): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    reason: string | null;
};
type Recovery = (folder: string, policy: 'reload' | 'stop') => Promise<{
    ok: boolean;
    [key: string]: any;
}>;
export declare class HealthMonitor {
    private container;
    private recover;
    private records;
    private timers;
    private pending;
    private timedOut;
    private processing;
    private cancellations;
    private started;
    private closed;
    private ledger;
    private ledgerReadable;
    constructor(container: Container, recover: Recovery);
    private config;
    private entry;
    private persist;
    private transition;
    start(): void;
    refresh(): void;
    private schedule;
    private eligible;
    probe(folder: string): Promise<void>;
    close(): Promise<void>;
}
export {};
