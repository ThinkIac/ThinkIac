import { Container } from '../../kernel/container';
import type { EffectScope } from '../../kernel/effects';
declare const ProcessBridge: any;
/** Connects the host bus and lifecycle to the reusable transport. */
declare class ProcBridge extends ProcessBridge {
    private container;
    private folder;
    private unsubscribes;
    private scope?;
    constructor(container: Container, opts: {
        folder?: string;
        name: string;
        dir: string;
        runtime: string;
        main: string;
        events: string[];
        scope?: EffectScope;
    });
    private subscribe;
    stop(): void;
}
/** Spawns bridges for every workspace module declared with a non-node runtime. */
export declare function startProcessModule(container: Container, pkg: any): ProcBridge | null;
export declare function stopProcessModule(container: Container, folder: string): Promise<void>;
export {};
