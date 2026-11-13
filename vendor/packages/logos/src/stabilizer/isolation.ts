// stabilizer/isolation.ts — o que um pacote pode e não pode derrubar.
//
// O stabilizer já isola a TROCA de código: cada pacote é validado num router
// fantasma e trocado sozinho, sem reiniciar o processo (staging.ts). O que
// faltava era isolar o RESET: um `process.exit()` global mata junto todo
// estado vivo do runtime — sessões de terminal, uploads em voo, streams —
// mesmo que só um pacote precisasse voltar.
//
// Aqui um pacote se declara crítico no próprio package.json:
//
//   "runtime": {
//     "isolation": {
//       "critical": true,
//       "reason": "sessões de terminal ao vivo morrem com o processo"
//     }
//   }
//
// Um pacote crítico não impede nada por decreto — ele obriga quem pede um
// reset global a passar por `requestReboot()`, que responde com o custo real
// (quais pacotes críticos, quantas sessões abertas) e só libera com `force`.
// Recarregar um pacote isolado continua sendo o caminho normal: o stabilizer,
// via `runtime_commit` / evento `reload:commit`.

'use strict';

import { isolatedRunnerFor, getIsolatedRunner, stopIsolatedRunner } from '../core/isolated/bridge';
import { stagePackageUnlocked } from './staging';

import { Container } from '../kernel/container';
import { externalApi } from '../kernel/external-modules';

function getHub(container: Container): any { return externalApi<any>(container, 'ws').getHub(); }
function clearRouter(container: Container, pkg: string): void { externalApi<any>(container, 'http').clearRouter(pkg); }
import { packageOperation } from './operations';

export interface PackageIsolation {
  critical: boolean;
  reason?: string;
}

export interface RebootImpact {
  /** Pacotes críticos que perderiam estado vivo com um reset global. */
  critical: Array<{ pkg: string; reason?: string }>;
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

/** Sessões internas do runtime — não contam como "usuário ao vivo". */
const INTERNAL_SESSIONS = new Set(['views-hmr', 'default']);

export function packageIsolation(pkg: any): PackageIsolation {
  const declared = pkg?.runtime?.isolation;
  if (!declared || declared.critical !== true) return { critical: false };
  return { critical: true, reason: declared.reason };
}

export function isCritical(container: Container, pkgFolder: string): boolean {
  return packageIsolation(container.registry.getPackage(pkgFolder)).critical;
}

/** Todos os pacotes do workspace que se declaram críticos. */
export function criticalPackages(container: Container): Array<{ pkg: string; reason?: string }> {
  return container.registry.discover()
    .map(pkg => ({ folder: pkg.folder, isolation: packageIsolation(pkg) }))
    .filter(entry => entry.isolation.critical)
    .map(entry => ({ pkg: entry.folder, reason: entry.isolation.reason }));
}

/** O que um reset global custaria agora. */
export function rebootImpact(container: Container): RebootImpact {
  const hub = getHub(container);
  const liveSessions = [...hub.connections.keys()].filter(id => !INTERNAL_SESSIONS.has(id));
  return { critical: criticalPackages(container), liveSessions };
}

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
export async function requestReboot(
  container: Container,
  options: { reason?: string; force?: boolean } = {},
): Promise<RebootVerdict> {
  const impact = rebootImpact(container);
  const force = options.force === true;

  const verdict = await container.bus.veto('runtime:reboot_requested', {
    reason: options.reason ?? null,
    force,
    impact,
  });
  if (!verdict.allowed && !force) {
    return { allowed: false, forced: false, impact, blockedBy: verdict.by ?? 'veto' };
  }

  if (!force && impact.critical.length && impact.liveSessions.length) {
    return {
      allowed: false,
      forced: false,
      impact,
      blockedBy: `pacote(s) crítico(s) ${impact.critical.map(c => c.pkg).join(', ')} com ` +
        `${impact.liveSessions.length} sessão(ões) ao vivo — recarregue o pacote ` +
        `(runtime_commit) ou repita com force: true`,
    };
  }

  return { allowed: true, forced: force, impact };
}

// ── Parar e subir um pacote (sem tocar no processo) ──────────────────────────

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
export function stopPackage(container: Container, pkgFolder: string, options: { force?: boolean } = {}): Promise<StopResult> {
  return packageOperation(container, pkgFolder, () => stopPackageUnlocked(container, pkgFolder, options));
}

/** Internal: caller must hold the package operation lock. */
export async function stopPackageUnlocked(
  container: Container,
  pkgFolder: string,
  options: { force?: boolean } = {},
): Promise<StopResult> {
  if (isCritical(container, pkgFolder) && options.force !== true) {
    return {
      ok: false,
      pkg: pkgFolder,
      handlersDropped: 0,
      error: `"${pkgFolder}" é crítico — pare com force: true se aceitar perder o estado vivo dele`,
    };
  }

  await container.state('supervisor').get('controller')?.beforeStop(pkgFolder);
  await stopIsolatedRunner(container, pkgFolder, 'package_stopped');
  clearRouter(container, pkgFolder);
  const handlersDropped = getHub(container).offOwner(pkgFolder);
  const scopeReport = typeof (container as any).disposePackageScope === 'function'
    ? await container.disposePackageScope(pkgFolder, 'package_stopped')
    : null;
  container.registry.setState(pkgFolder, 'stopped');
  await container.bus.emit('package:stopped', { pkg: pkgFolder, handlersDropped });
  container.log?.(`[isolation] "${pkgFolder}" parado — rotas limpas, ${handlersDropped} stream handler(s) soltos`);

  return {
    ok: true,
    pkg: pkgFolder,
    handlersDropped,
    resourcesDisposed: scopeReport?.disposed ?? 0,
    resourceFailures: scopeReport?.failed ?? 0,
  };
}

/**
 * Sobe (ou ressuscita) um pacote pelo mesmo caminho de um hot swap: rotas são
 * montadas num router fantasma, validadas e trocadas; hooks e streams voltam a
 * se registrar. Serve tanto para dar play num pacote parado quanto para
 * recarregar um pacote vivo.
 */
export async function startPackage(container: Container, pkgFolder: string) {
  return packageOperation(container, pkgFolder, async () => {
    await container.state('supervisor').get('controller')?.beforeStart(pkgFolder);
    return stagePackageUnlocked(container, pkgFolder);
  });
}

/** Recover a dead isolated child through the normal staged surface activation. */
export function recoverIsolatedPackage(container: Container, folder: string) {
  return packageOperation(container, folder, async () => {
    const controller = container.state('supervisor').get('controller');
    if (controller && !controller.wantsRunning(folder)) return { ok: false, error: 'Package stopped' };
    const pkg = container.registry.getPackage(folder);
    if (!pkg || (pkg.isolated !== true && pkg.runtime?.mode !== 'isolated')) return { ok: false, error: 'Not an isolated package' };
    if (getIsolatedRunner(container, folder)?.running) return { ok: true };
    try {
      const result = await stagePackageUnlocked(container, folder);
      if (!result.ok) throw new Error(result.error);
      return result;
    } catch (error: any) {
      await stopIsolatedRunner(container, folder, 'recovery_failed');
      container.registry.setState(folder, 'failed', error.message);
      return { ok: false, error: error.message };
    }
  });
}
