// Deprecated concrete parsers are optional compatibility adapters.
import { externalModulePath } from './module-resolution';
import type * as Contract from './contracts/parsers';
export { parseModule } from './module-declarations';
export type { RouteOfflinePolicy } from './contracts/parsers';
export const OFFLINE_POLICIES: Contract.RouteOfflinePolicy[] = ['cache', 'online'];
const implementation = () => require(require('node:path').join(externalModulePath('annotations'), 'parsers.cjs'));
export const parseOffline: typeof Contract.parseOffline = (...args: any[]) => implementation().parseOffline(...args);
export const parseTool: typeof Contract.parseTool = (...args: any[]) => implementation().parseTool(...args);
export const parseHook: typeof Contract.parseHook = (...args: any[]) => implementation().parseHook(...args);
export const parseRoute: typeof Contract.parseRoute = (...args: any[]) => implementation().parseRoute(...args);
export const parseCommand: typeof Contract.parseCommand = (...args: any[]) => implementation().parseCommand(...args);
export const parsePredicate: typeof Contract.parsePredicate = (...args: any[]) => implementation().parsePredicate(...args);
export const parseMiddleware: typeof Contract.parseMiddleware = (...args: any[]) => implementation().parseMiddleware(...args);
