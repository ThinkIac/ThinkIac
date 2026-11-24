// Compatibility facade. Resource semantics belong to module-annotations.
import { annotatedCompatibility } from './annotations-compat';
import type * as Contract from './contracts/middleware';
export const loadMiddlewareSnapshot: typeof Contract.loadMiddlewareSnapshot = (...args: any[]) => annotatedCompatibility('middleware').loadMiddlewareSnapshot(...args);
export const resolveMiddlewares: typeof Contract.resolveMiddlewares = (...args: any[]) => annotatedCompatibility('middleware').resolveMiddlewares(...args);
export const runMiddlewares: typeof Contract.runMiddlewares = (...args: any[]) => annotatedCompatibility('middleware').runMiddlewares(...args);
