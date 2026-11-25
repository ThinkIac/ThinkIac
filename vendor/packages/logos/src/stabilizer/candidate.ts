// Compatibility facade. Implementation belongs to the optional stabilizer module.
import { stabilizationLibrary, lazyStabilizationClass } from '../kernel/stabilization-compat';
import type * as Contract from './contracts/candidate';
export const candidateManifest: typeof Contract.candidateManifest = (...args: any[]) => stabilizationLibrary('candidate').candidateManifest(...args);
export const candidateHash: typeof Contract.candidateHash = (...args: any[]) => stabilizationLibrary('candidate').candidateHash(...args);
export const createCandidate: typeof Contract.createCandidate = (...args: any[]) => stabilizationLibrary('candidate').createCandidate(...args);
export const candidateContributors: typeof Contract.candidateContributors = (...args: any[]) => stabilizationLibrary('candidate').candidateContributors(...args);
