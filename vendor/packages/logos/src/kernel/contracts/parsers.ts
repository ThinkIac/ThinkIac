export type RouteOfflinePolicy = 'cache' | 'online';
export declare const OFFLINE_POLICIES: RouteOfflinePolicy[];
/**
 * `queue` (fila de escrita) é recusado de propósito enquanto não existir dedupe
 * por chave de idempotência no servidor: sem isso, reenviar uma mutação depois
 * de uma oscilação de rede cria registro duplicado — exatamente o defeito que a
 * fila deveria evitar. Recusar no carregamento é melhor que aceitar e ignorar,
 * porque um pacote que escreveu `queue` acreditaria que a escrita está
 * protegida quando não está.
 */
export declare function parseOffline(doc: string, method?: string): RouteOfflinePolicy;
export declare function parseRoute(fn: Function, doc: string | null): {
    path: string;
    method: string;
    public: boolean;
    handler: Function;
    upload: any;
    offline: RouteOfflinePolicy;
    streaming: boolean;
    stream: boolean;
    direction: string;
    channel: string;
    credentialRequired: boolean;
    condition: Record<string, string[]>;
};
export declare function parseTool(fn: Function, doc: string | null): {
    name: string;
    description: string;
    parameters: any[];
    call: Function;
    condition: Record<string, string[]>;
    reach: import("../jsdoc").Reach;
    recoveryPolicy: string;
    reconcileTool: string;
};
export declare function parseHook(fn: Function, doc: string | null): {
    event: string;
    call: Function;
    priority: number;
    condition: Record<string, string[]>;
};
export declare function parseCommand(fn: Function, doc: string | null): {
    order?: string[];
    name: string;
    description: string;
    parameters: any[];
    call: Function;
    condition: Record<string, string[]>;
    cliRuntime: string;
};
export declare function parsePredicate(fn: Function, doc: string | null): {
    name: string;
    call: Function;
};
export declare function parseMiddleware(fn: Function, doc: string | null): {
    name: string;
    call: Function;
    predicates: string[];
};
export declare function parseModule(fn: Function, doc: string | null): {
    name: string;
    phase: string;
    after: string[];
    requires: string[];
    swappable: boolean;
    runtime: string;
    events: string[];
    install: Function;
};
