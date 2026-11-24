// Compatibility facade. Implementation belongs to the optional stabilizer module.
import { stabilizationLibrary, lazyStabilizationClass } from '../kernel/stabilization-compat';
import type * as Contract from './contracts/checkpoint';
export type CheckpointStore = Contract.CheckpointStore;
export const CheckpointStore: typeof Contract.CheckpointStore = lazyStabilizationClass('checkpoint', 'CheckpointStore');
