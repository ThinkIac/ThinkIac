export declare function candidateManifest(root: string): Array<{
    path: string;
    hash: string;
}>;
export declare function candidateHash(root: string): string;
export declare function createCandidate(root: string): {
    schemaVersion: number;
    candidateId: `${string}-${string}-${string}-${string}-${string}`;
    candidateHash: string;
    producedAt: number;
};
export declare function candidateContributors(root: string, evidence: any[]): {
    authors: {
        sessionId: any;
        runId: any;
        taskId: any;
    }[];
    operationIds: any[];
};
