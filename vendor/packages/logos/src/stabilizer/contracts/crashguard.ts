import { CheckpointStore } from './checkpoint';
/** Call at the very start of bootstrap(). May restore the workspace. */
export declare function bootAttempt(workspace: string, checkpoints: CheckpointStore, stateDir?: string): {
    restored: boolean;
};
/** Call once the runtime reaches a stable state — resets the counter. */
export declare function bootStable(workspace: string, stateDir?: string): void;
