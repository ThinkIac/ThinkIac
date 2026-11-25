import { createCandidate } from './candidate';
import { Container } from '../../kernel/container';
export interface StagingResult {
    ok: boolean;
    pkg: string;
    candidateId?: string;
    candidateHash?: string;
    activated?: boolean;
    checks: Array<{
        name: string;
        ok: boolean;
        detail?: string;
    }>;
    error?: string;
}
export declare function stagePackage(container: Container, pkgFolder: string): Promise<StagingResult>;
/** Internal: caller must hold the package operation lock. */
export declare function stagePackageUnlocked(container: Container, pkgFolder: string, expectedCandidate?: ReturnType<typeof createCandidate>): Promise<StagingResult>;
