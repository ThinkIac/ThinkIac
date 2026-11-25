// Injectable compatibility implementation, owned by module-stabilizer.
module.exports = function (require, module, exports, __dirname, __filename) {
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.packageIsolation = packageIsolation;
exports.isCritical = isCritical;
exports.criticalPackages = criticalPackages;
exports.rebootImpact = rebootImpact;
exports.requestReboot = requestReboot;
exports.stopPackage = stopPackage;
exports.stopPackageUnlocked = stopPackageUnlocked;
exports.startPackage = startPackage;
exports.recoverIsolatedPackage = recoverIsolatedPackage;
const bridge_1 = require("../core/isolated/bridge");
const staging_1 = require("./staging");
// Compatibility inventory reads never instantiate an optional transport.
function getHub(container) { return container.state('ws').get('hub'); }
function clearRouter(container, pkg) {
    const api = container.state('external-api').get('http');
    if (api)
        api.clearRouter(pkg);
    else {
        const router = container.state('routers').get(pkg);
        if (router)
            router.stack = [];
    }
}
const operations_1 = require("./operations");
/** Sessões internas do runtime — não contam como "usuário ao vivo". */
const INTERNAL_SESSIONS = new Set(['views-hmr', 'default']);
function packageIsolation(pkg) {
    const declared = pkg?.runtime?.isolation;
    if (!declared || declared.critical !== true)
        return { critical: false };
    return { critical: true, reason: declared.reason };
}
function isCritical(container, pkgFolder) {
    return packageIsolation(container.registry.getPackage(pkgFolder)).critical;
}
/** Todos os pacotes do workspace que se declaram críticos. */
function criticalPackages(container) {
    return container.registry.discover()
        .map(pkg => ({ folder: pkg.folder, isolation: packageIsolation(pkg) }))
        .filter(entry => entry.isolation.critical)
        .map(entry => ({ pkg: entry.folder, reason: entry.isolation.reason }));
}
/** O que um reset global custaria agora. */
function rebootImpact(container) {
    const hub = getHub(container);
    const liveSessions = [...(hub?.connections.keys() ?? [])].filter(id => !INTERNAL_SESSIONS.has(id));
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
async function requestReboot(container, options = {}) {
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
/**
 * Desliga UM pacote: esvazia o stack de rotas dele e solta os handlers de
 * @stream que ele registrou. O processo, e todo o resto, seguem de pé — é o
 * oposto do `process.exit()`.
 *
 * Um pacote crítico exige `force`: ele avisou que segura estado vivo.
 */
function stopPackage(container, pkgFolder, options = {}) {
    return (0, operations_1.packageOperation)(container, pkgFolder, () => stopPackageUnlocked(container, pkgFolder, options));
}
/** Internal: caller must hold the package operation lock. */
async function stopPackageUnlocked(container, pkgFolder, options = {}) {
    if (isCritical(container, pkgFolder) && options.force !== true) {
        return {
            ok: false,
            pkg: pkgFolder,
            handlersDropped: 0,
            error: `"${pkgFolder}" é crítico — pare com force: true se aceitar perder o estado vivo dele`,
        };
    }
    await container.state('supervisor').get('controller')?.beforeStop(pkgFolder);
    await (0, bridge_1.stopIsolatedRunner)(container, pkgFolder, 'package_stopped');
    clearRouter(container, pkgFolder);
    const handlersDropped = getHub(container)?.offOwner(pkgFolder) ?? 0;
    const scopeReport = typeof container.disposePackageScope === 'function'
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
async function startPackage(container, pkgFolder) {
    return (0, operations_1.packageOperation)(container, pkgFolder, async () => {
        await container.state('supervisor').get('controller')?.beforeStart(pkgFolder);
        return (0, staging_1.stagePackageUnlocked)(container, pkgFolder);
    });
}
/** Recover a dead isolated child through the normal staged surface activation. */
function recoverIsolatedPackage(container, folder) {
    return (0, operations_1.packageOperation)(container, folder, async () => {
        const controller = container.state('supervisor').get('controller');
        if (controller && !controller.wantsRunning(folder))
            return { ok: false, error: 'Package stopped' };
        const pkg = container.registry.getPackage(folder);
        if (!pkg || (pkg.isolated !== true && pkg.runtime?.mode !== 'isolated'))
            return { ok: false, error: 'Not an isolated package' };
        if ((0, bridge_1.getIsolatedRunner)(container, folder)?.running)
            return { ok: true };
        try {
            const result = await (0, staging_1.stagePackageUnlocked)(container, folder);
            if (!result.ok)
                throw new Error(result.error);
            return result;
        }
        catch (error) {
            await (0, bridge_1.stopIsolatedRunner)(container, folder, 'recovery_failed');
            container.registry.setState(folder, 'failed', error.message);
            return { ok: false, error: error.message };
        }
    });
}

};
