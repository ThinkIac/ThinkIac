import { Container, LogosModule } from '../../kernel/container';
export declare function toolToMcp(container: Container, tool: any, pkgFolder: string | null): {
    name: any;
    qualifiedName: string;
    description: any;
    inputSchema: any;
    condition: any;
    reach: any;
    recoveryPolicy: any;
    reconcileTool: any;
    handler(args: any, context?: any): Promise<any>;
};
/** Tools the kernel itself offers to agents (self-modification control loop). */
export declare function kernelTools(container: Container): ({
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            package: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    condition: any;
    handler(args: any): Promise<any>;
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            package: {
                type: string;
                description: string;
            };
        };
        required?: undefined;
    };
    condition: any;
    handler(args: any): Promise<any>;
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            package?: undefined;
        };
        required?: undefined;
    };
    condition: any;
    handler(): Promise<{
        rebootAdvised: boolean;
        blockedBy: string;
        criticalPackages: {
            pkg: string;
            reason?: string;
        }[];
        liveSessions: string[];
    }>;
} | {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            package?: undefined;
        };
        required?: undefined;
    };
    condition: any;
    handler(): Promise<{
        packages: Record<string, any>;
        errors: any[];
    }>;
})[];
export declare function loadMcpTools(container: Container, agentFolder: string): Promise<{
    name: any;
    qualifiedName: string;
    description: any;
    inputSchema: any;
    condition: any;
    reach: any;
    recoveryPolicy: any;
    reconcileTool: any;
    handler(args: any, context?: any): Promise<any>;
}[]>;
export declare const toolsModule: LogosModule;
