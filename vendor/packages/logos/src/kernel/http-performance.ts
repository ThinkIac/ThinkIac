// Compatibility facade. HTTP instrumentation belongs to module-http.
import { lazyCapabilityClass, capabilityImplementation } from './lazy-capability';
import type * as Contract from './contracts/http-performance';
export type HttpPerformance = Contract.HttpPerformance;
export const HttpPerformance: typeof Contract.HttpPerformance = lazyCapabilityClass('http', 'performance.cjs', 'HttpPerformance');
export const setPerformanceRoute: typeof Contract.setPerformanceRoute = (...args) => capabilityImplementation('http', 'performance.cjs').setPerformanceRoute(...args);
export const recordPhase: typeof Contract.recordPhase = (...args) => capabilityImplementation('http', 'performance.cjs').recordPhase(...args);
export const measurePhase: typeof Contract.measurePhase = (...args) => capabilityImplementation('http', 'performance.cjs').measurePhase(...args);
