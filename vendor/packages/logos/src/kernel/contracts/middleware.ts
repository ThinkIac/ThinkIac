export declare function loadMiddlewareSnapshot(pkgFolder: string): Promise<{
    predicates: Record<string, Function>;
    middlewares: any[];
}>;
/** Metadata belongs to a router generation; predicate decisions belong to a request. */
export declare function resolveMiddlewares(pkgFolder: string, context: any, snapshot?: Awaited<ReturnType<typeof loadMiddlewareSnapshot>>): Promise<any[]>;
export declare function runMiddlewares(middlewares: any[], context: any, handler: () => any): Promise<any>;
