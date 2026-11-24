import { Container } from '../../../kernel/container';
export type OfflineMode = 'off' | 'shell';
export type OfflineReload = 'prompt' | 'manual';
/** `all` = todas as views do pacote; `visited` = as que forem abertas; ou uma lista. */
export type OfflineViews = 'all' | 'visited' | string[];
export interface OfflinePolicy {
    mode: OfflineMode;
    /** Mostra a pílula cinza "Offline mode". `false` = app offline-first, fica calado. */
    badge: boolean;
    views: OfflineViews;
    reload: OfflineReload;
}
export declare const OFFLINE_MODES: OfflineMode[];
export declare const DEFAULT_OFFLINE_POLICY: OfflinePolicy;
/**
 * Precedência, do mais específico ao mais geral:
 *
 *   1. `runtime.offline` do package.json   (o pacote se declara)
 *   2. `views.offline` do bootstrap        (política do runtime)
 *   3. mode 'off'                          (default: nenhum Service Worker)
 *
 * O default é `off` de propósito. Um Service Worker de escopo raiz muda o
 * comportamento de rede do app inteiro; isso não pode acontecer porque alguém
 * esqueceu de desligar.
 */
export declare function resolveOfflinePolicy(container: Container, pkgFolder: string): OfflinePolicy;
export declare function recordOfflineRoutes(container: Container, pkgFolder: string, routes: any[]): void;
export declare function getOfflineRoutes(container: Container, pkgFolder: string): string[];
/**
 * `/lectio/api/documents/:id/blocks` → `^/lectio/api/documents/[^/]+/blocks$`
 *
 * A conversão acontece aqui, no servidor, e não no Service Worker: o formato
 * Express é conhecido de um lado só, e duplicar a tradução no cliente cria duas
 * gramáticas para divergir.
 */
export declare function routePatternToRegex(mountPath: string): string;
export interface OfflineManifest {
    version: string;
    index: string | null;
    packages: Record<string, {
        mode: OfflineMode;
        badge: boolean;
        reload: OfflineReload;
        views: string[];
        cache: string[];
    }>;
}
export declare function buildOfflineManifest(container: Container): OfflineManifest;
/**
 * O SW é gerado com o manifesto embutido. Trocar a política troca os bytes do
 * script, e o browser trata bytes diferentes como versão nova — a atualização
 * do SW sai de graça do mecanismo que já existe.
 */
export declare function serviceWorkerScript(manifest: OfflineManifest): string;
/**
 * Registra o SW e desenha o estado da rede.
 *
 * O badge cinza "Offline mode" é novo; o azul "↻ Update available" é o mesmo do
 * hot-reload, reusado de propósito — dois botões de recarregar desenhados
 * diferente é pior que um.
 */
export declare function offlineClientScript(policy: OfflinePolicy): string;
