// Compatibility facade. Resource semantics belong to module-annotations.
import { annotatedCompatibility } from './annotations-compat';
import type * as Contract from './contracts/conditions';
export type { Condition } from './contracts/conditions';
export const resolveConditions: typeof Contract.resolveConditions = (...args: any[]) => annotatedCompatibility('conditions').resolveConditions(...args);
