import type * as http from 'http';
export type ExposeMode = 'path' | 'subdomain' | 'port-only';
export interface ResolvedTarget {
    slug: string;
    /** URL to request on the branch instance. */
    path: string;
}
export declare function resolveTarget(mode: ExposeMode, url: string, host: string | undefined, knownSlug: (slug: string) => boolean): ResolvedTarget | null;
export declare function proxyRequest(port: number, targetPath: string, req: any, res: any, onDone: () => void): void;
/**
 * WebSocket upgrades to a branch. The main runtime's own hub owns `/ws` on
 * this port, so we install ourselves as the single 'upgrade' listener and
 * hand everything that is not a branch back to the listeners that were there
 * before us — otherwise `ws` would abort the handshake for foreign paths.
 */
export declare function installUpgradeProxy(server: http.Server, resolve: (req: http.IncomingMessage) => {
    port: number;
    path: string;
    slug: string;
} | null, hold: (slug: string) => void, release: (slug: string) => void): () => void;
