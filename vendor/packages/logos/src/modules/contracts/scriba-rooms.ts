export declare class ScribaRooms {
    private connections;
    private options;
    private disposed;
    private sequence;
    constructor(options: any);
    get connectionCount(): number;
    private key;
    private send;
    private close;
    private remove;
    private enqueue;
    private principal;
    private revoke;
    private deliver;
    private sendPresence;
    handle(ws: any, req: any, input: any): Promise<any>;
    idle(): Promise<void>;
    sweep(): Promise<void>;
    dispose(): void;
}
