export interface PackageManifest {
    name: string;
    version?: string;
    description?: string;
    tools: {
        name: string;
        description: string | null;
        parameters: any;
        reach: string;
        recoveryPolicy: string | null;
        reconcileTool: string | null;
    }[];
    hooks: {
        event: string;
        priority: number;
    }[];
    routes: {
        path: string;
        method: string;
    }[];
    commands: {
        name: string;
        description: string | null;
        parameters: any;
        order?: string[];
    }[];
    generatedAt: string;
}
export declare function generateManifest(agentFolder: string): Promise<PackageManifest>;
export declare function writeManifest(agentFolder: string, outFile?: string): Promise<string>;
