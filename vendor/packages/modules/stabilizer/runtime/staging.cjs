// Injectable compatibility implementation, owned by module-stabilizer.
module.exports = function (require, module, exports, __dirname, __filename) {
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stagePackage = stagePackage;
exports.stagePackageUnlocked = stagePackageUnlocked;
const bridge_1 = require("../core/isolated/bridge");
// stabilizer/staging.ts — validate-before-swap.
//
// Builds the changed package's routes into a GHOST express.Router (never
// mounted), loads its decorators fresh, and runs the health criteria declared
// in the package's package.json:
//
//   "runtime": {
//     "stability": {
//       "tools": "all" | ["vital_tool_a", "vital_tool_b"],
//       "routes": ["health"],           ← smoke-dispatched in-process
//       "timeout": 10000,
//       "maxRetries": 3
//     }
//   }
//
// Only when every criterion passes does the swap happen: the live router's
// stack is replaced by the ghost's in one assignment (in-flight requests
// finish on the old closures), and hooks/streams re-register. On failure the
// live version keeps serving, untouched.
'use strict';
const path_1 = __importDefault(require("path"));
const declaration_events_1 = require("../kernel/declaration-events");
const candidate_1 = require("./candidate");
const operations_1 = require("./operations");
const health_1 = require("./health");
const scan_1 = require("../kernel/scan");
const package_contract_1 = require("../kernel/package-contract");
const package_wiring_1 = require("../kernel/package-wiring");
const DEFAULT_TIMEOUT = 10_000;
function stagePackage(container, pkgFolder) {
    return (0, operations_1.packageOperation)(container, pkgFolder, () => stagePackageUnlocked(container, pkgFolder));
}
/** Internal: caller must hold the package operation lock. */
async function stagePackageUnlocked(container, pkgFolder, expectedCandidate) {
    const controller = container.state('supervisor').get('controller');
    if (controller && !controller.wantsRunning(pkgFolder))
        return { ok: false, pkg: pkgFolder, checks: [], error: 'Package stopped; use start explicitly' };
    const pkg = container.registry.getPackage(pkgFolder);
    if (pkg?.isolated !== true && pkg?.runtime?.mode !== 'isolated')
        return stagePackageCandidate(container, pkgFolder, expectedCandidate);
    const previous = (0, bridge_1.getIsolatedRunner)(container, pkgFolder);
    // Candidate lookups are local to this async operation. Live requests retain the old runner.
    const candidate = await (0, bridge_1.isolatedRunnerFor)(container, pkg, false);
    if (!candidate)
        throw new Error('Isolated candidate unavailable');
    try {
        const result = await (0, bridge_1.withStagedIsolated)(container, pkgFolder, candidate, () => stagePackageCandidate(container, pkgFolder, expectedCandidate));
        if (result.ok) {
            container.state('isolated').set(pkgFolder, candidate);
            await previous?.stop('replaced');
        }
        else {
            await candidate.stop('candidate_rejected');
            if (!previous?.running)
                container.registry.setState(pkgFolder, 'failed', result.error);
        }
        return result;
    }
    catch (error) {
        await candidate.stop('candidate_failed');
        throw error;
    }
}
async function stagePackageCandidate(container, pkgFolder, expectedCandidate) {
    const pkg = container.registry.getPackage(pkgFolder);
    const stability = pkg?.runtime?.stability ?? {};
    const timeout = stability.timeout ?? DEFAULT_TIMEOUT;
    const checks = [];
    const root = path_1.default.join(container.workspace, pkgFolder);
    let candidate;
    try {
        candidate = expectedCandidate || (0, candidate_1.createCandidate)(root);
    }
    catch (error) {
        return fail(container, pkgFolder, checks, error.message);
    }
    container.registry.setState(pkgFolder, 'staging');
    await container.bus.emit('reload:staging', { pkg: pkgFolder });
    let candidateContract;
    try {
        (0, health_1.normalizeMonitor)(stability.monitor);
        candidateContract = (0, package_contract_1.normalizePackageContract)(pkg);
        checks.push({ name: 'contract:valid', ok: true, detail: candidateContract.hash });
    }
    catch (err) {
        checks.push({ name: 'contract:valid', ok: false, detail: err.message });
        return fail(container, pkgFolder, checks, err.message);
    }
    const activeContract = container.registry.getActiveContract(pkgFolder);
    if (activeContract) {
        const authorityDiff = (0, package_contract_1.diffPackageAuthority)(activeContract.contract, candidateContract.contract);
        if (authorityDiff.expanded.length) {
            const approval = container.authority.consumeExpansionApproval({
                package: pkgFolder,
                beforeHash: activeContract.hash,
                afterHash: candidateContract.hash,
                expanded: authorityDiff.expanded,
            });
            const ok = approval !== null;
            checks.push({
                name: 'authority:expansion',
                ok,
                detail: ok ? `approved by ${approval.decisionId}` : `approval required for: ${authorityDiff.expanded.join(', ')}`,
            });
            if (!ok)
                return fail(container, pkgFolder, checks, 'authority expansion requires an exact hash-bound approval');
        }
    }
    try {
        const wiring = await (0, package_wiring_1.validatePackageWiring)(container, pkg);
        checks.push({ name: 'contract:capabilities', ok: true, detail: `${wiring.tools} tool(s), ${wiring.hooks} hook(s)` });
    }
    catch (err) {
        checks.push({ name: 'contract:capabilities', ok: false, detail: err.message });
        return fail(container, pkgFolder, checks, err.message);
    }
    // Fresh scan — the ghost must reflect the NEW code, not the cache.
    const folderPath = (0, scan_1.resolveAgentFolder)(pkgFolder);
    if (folderPath)
        scan_1.scanCache.invalidatePrefix(folderPath);
    const artifacts = new Map();
    try {
        await container.bus.emitStrict('logos:package:staging', { version: 1, pkg, checks, artifacts });
    }
    catch (error) {
        return fail(container, pkgFolder, checks, error.message);
    }
    // ── 4. Packages may veto the swap (reload:validating) ─────────────────────
    const verdict = await container.bus.veto('reload:validating', { pkg: pkgFolder, checks });
    if (!verdict.allowed) {
        checks.push({ name: 'veto', ok: false, detail: `${verdict.by}: ${verdict.reason ?? 'vetoed'}` });
        return fail(container, pkgFolder, checks, `swap vetoed by ${verdict.by}`);
    }
    try {
        if ((0, candidate_1.candidateHash)(root) !== candidate.candidateHash)
            throw new Error('Candidate changed during staging');
        checks.push({ name: 'candidate:unchanged', ok: true, detail: candidate.candidateHash });
    }
    catch (error) {
        checks.push({ name: 'candidate:unchanged', ok: false });
        return fail(container, pkgFolder, checks, error.message);
    }
    // ── 5. Atomic swap ────────────────────────────────────────────────────────
    let resources;
    try {
        resources = await (0, declaration_events_1.preparePackageResources)(container, pkg);
    }
    catch (error) {
        return fail(container, pkgFolder, checks, error.message);
    }
    const previousSchemas = container.eventContracts.forOwner(pkgFolder);
    try {
        if ((0, candidate_1.candidateHash)(root) !== candidate.candidateHash)
            throw new Error('Candidate changed during resource preparation');
        container.eventContracts.replaceOwner(pkgFolder, candidateContract.contract.provides.eventSchemas);
        await resources.commit();
        await container.bus.emitStrict('logos:package:swapping', { version: 1, pkg, checks, artifacts });
    }
    catch (error) {
        container.eventContracts.replaceOwner(pkgFolder, previousSchemas);
        await resources.rollback();
        return fail(container, pkgFolder, checks, error.message);
    }
    await resources.finish();
    await container.bus.emit('reload:streams', { pkg });
    await container.bus.emit('views:package_reloaded', { pkg: pkgFolder });
    container.registry.setState(pkgFolder, 'active');
    container.registry.setActiveContract(pkgFolder, candidateContract);
    container.services.configureOwner(pkgFolder, {
        provides: candidateContract.contract.provides.services,
        requires: candidateContract.contract.requires.services,
    });
    await container.bus.emit('reload:swapped', { pkg: pkgFolder, checks, ...candidate, activated: true });
    container.log(`[stabilizer] "${pkgFolder}" swapped — ${checks.length} check(s) green`);
    return { ok: true, pkg: pkgFolder, checks, ...candidate, activated: true };
}
function fail(container, pkgFolder, checks, error) {
    container.registry.setState(pkgFolder, 'active'); // old version keeps serving
    container.log(`[stabilizer] "${pkgFolder}" staging FAILED (old version still live): ${error}`);
    return { ok: false, pkg: pkgFolder, checks, error };
}

};
