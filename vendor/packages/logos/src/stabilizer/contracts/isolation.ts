import { Container } from '../../kernel/container';
export interface PackageIsolation {
    critical: boolean;
    reason?: string;
}
export interface RebootImpact {
    /** Pacotes críticos que perderiam estado vivo com um reset global. */
    critical: Array<{
        pkg: string;
        reason?: string;
    }>;
    /** Sessões WebSocket abertas agora (exclui as do próprio cliente de HMR). */
    liveSessions: string[];
}
export interface RebootVerdict {
    allowed: boolean;
    forced: boolean;
    impact: RebootImpact;
    /** Preenchido quando `allowed` é false: por que o reset foi barrado. */
    blockedBy?: string;
}
export declare function packageIsolation(pkg: any): PackageIsolation;
export declare function isCritical(container: Container, pkgFolder: string): boolean;
/** Todos os pacotes do workspace que se declaram críticos. */
export declare function criticalPackages(container: Container): Array<{
    pkg: string;
    reason?: string;
}>;
/** O que um reset global custaria agora. */
export declare function rebootImpact(container: Container): RebootImpact;
/**
 * Porta de entrada de qualquer reset global do processo.
 *
 * Barra quando existe pacote crítico E sessão viva — o caso em que o reset
 * cobra de alguém que não pediu nada. `force: true` passa por cima (é a
 * decisão do humano), mas o veredito ainda descreve o que vai cair, para que
 * quem chama consiga avisar antes.
 *
 * Pacotes podem vetar por conta própria assinando `runtime:reboot_requested`.
 */
export declare function requestReboot(container: Container, options?: {
    reason?: string;
    force?: boolean;
}): Promise<RebootVerdict>;
export interface StopResult {
    ok: boolean;
    pkg: string;
    /** Handlers de @stream descartados. */
    handlersDropped: number;
    /** Recursos instrumentados desmontados pelo EffectScope do pacote. */
    resourcesDisposed?: number;
    resourceFailures?: number;
    error?: string;
}
/**
 * Desliga UM pacote: esvazia o stack de rotas dele e solta os handlers de
 * @stream que ele registrou. O processo, e todo o resto, seguem de pé — é o
 * oposto do `process.exit()`.
 *
 * Um pacote crítico exige `force`: ele avisou que segura estado vivo.
 */
export declare function stopPackage(container: Container, pkgFolder: string, options?: {
    force?: boolean;
}): Promise<StopResult>;
/** Internal: caller must hold the package operation lock. */
export declare function stopPackageUnlocked(container: Container, pkgFolder: string, options?: {
    force?: boolean;
}): Promise<StopResult>;
/**
 * Sobe (ou ressuscita) um pacote pelo mesmo caminho de um hot swap: rotas são
 * montadas num router fantasma, validadas e trocadas; hooks e streams voltam a
 * se registrar. Serve tanto para dar play num pacote parado quanto para
 * recarregar um pacote vivo.
 */
export declare function startPackage(container: Container, pkgFolder: string): Promise<import("./staging").StagingResult>;
/** Recover a dead isolated child through the normal staged surface activation. */
export declare function recoverIsolatedPackage(container: Container, folder: string): Promise<import("./staging").StagingResult | {
    ok: boolean;
    error?: undefined;
} | {
    ok: boolean;
    error: any;
}>;
