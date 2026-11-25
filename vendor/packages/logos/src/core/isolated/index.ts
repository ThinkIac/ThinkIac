// Compatibility facade. Process execution belongs to module-isolated-runtime.
import { lazyCapabilityClass } from '../../kernel/lazy-capability';
import type * as Contract from './contracts';
export type { IsolatedSurface, IsolatedManifest, IsolatedRunnerOptions } from './contracts';
export type IsolatedRunner = Contract.IsolatedRunner;
export const IsolatedRunner: typeof Contract.IsolatedRunner = lazyCapabilityClass('isolated-runtime', 'runner.cjs', 'IsolatedRunner');
