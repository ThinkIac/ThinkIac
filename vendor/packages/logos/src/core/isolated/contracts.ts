export interface IsolatedSurface {
    id: string;
    kind: 'tool' | 'route' | 'hook';
    name?: string;
    path?: string;
    event?: string;
    method?: string;
    public?: boolean;
    description?: string | null;
    parameters?: any;
    condition?: any;
    priority?: number;
}
export interface IsolatedManifest {
    tools: IsolatedSurface[];
    routes: IsolatedSurface[];
    hooks: IsolatedSurface[];
    declarations: {
        id: string;
        file: string;
        declaration: import('../../kernel/declarations').DeclarationPayload;
    }[];
}
export interface IsolatedRunnerOptions {
    folder: string;
    dir: string;
    env?: Record<string, string>;
    timeoutMs?: number;
    onEvent?: (event: string, payload: any) => Promise<any>;
    onCapability?: (request: {
        surface: string;
        [key: string]: any;
    }) => Promise<any>;
    onLog?: (message: string) => void;
    onExit?: (event: {
        code: number | null;
        signal: string | null;
        expected: boolean;
        pid?: number;
    }) => void;
}
export declare class IsolatedRunner {
    private readonly options;
    private child;
    private pending;
    private sequence;
    private stopping;
    private manifest;
    constructor(options: IsolatedRunnerOptions);
    get running(): boolean;
    get surfaces(): IsolatedManifest | null;
    get pid(): number | undefined;
    start(): Promise<IsolatedManifest>;
    invoke(id: string, args: any[], context?: any): Promise<any>;
    stop(reason?: string): Promise<void>;
    private request;
    private onMessage;
    private onExit;
    private rejectAll;
}
