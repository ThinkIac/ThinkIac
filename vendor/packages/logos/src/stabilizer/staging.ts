import { isolatedRunnerFor, getIsolatedRunner, withStagedIsolated } from '../core/isolated/bridge';
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

import express from 'express';
import path from 'path';
import { candidateHash, createCandidate } from './candidate';
import { packageOperation } from './operations';
import { normalizeMonitor } from './health';
import { Container } from '../kernel/container';
import { scanCache, registerTools, resolveAgentFolder } from '../kernel/scan';
import { externalApi } from '../kernel/external-modules';
import { diffPackageAuthority, normalizePackageContract } from '../kernel/package-contract';
import { validatePackageWiring } from '../kernel/package-wiring';

const DEFAULT_TIMEOUT = 10_000;

export interface StagingResult {
  ok: boolean;
  pkg: string;
  candidateId?: string;
  candidateHash?: string;
  activated?: boolean;
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
  error?: string;
}

/** Dispatches a request into an unmounted router with a mock req/res pair. */
function smokeDispatch(router: any, method: string, url: string, timeout: number): Promise<number> {
  return new Promise(resolve => {
    let done = false;
    const finish = (status: number) => { if (!done) { done = true; resolve(status); } };

    const req: any = {
      method: method.toUpperCase(),
      url,
      originalUrl: url,
      headers: {},
      body: {},
      query: {},
      params: {},
    };
    const res: any = {
      statusCode: 200,
      headersSent: false,
      setHeader() { return this; },
      set() { return this; },
      getHeader() { return undefined; },
      status(code: number) { this.statusCode = code; return this; },
      json() { finish(this.statusCode); },
      send() { finish(this.statusCode); },
      end() { finish(this.statusCode); },
      redirect() { finish(302); },
    };

    try {
      router.handle(req, res, (err: any) => finish(err ? 500 : 404));
    } catch {
      finish(500);
    }
    setTimeout(() => finish(0), timeout).unref?.();
  });
}

export function stagePackage(container: Container, pkgFolder: string): Promise<StagingResult> {
  return packageOperation(container, pkgFolder, () => stagePackageUnlocked(container, pkgFolder));
}

/** Internal: caller must hold the package operation lock. */
export async function stagePackageUnlocked(container: Container, pkgFolder: string, expectedCandidate?: ReturnType<typeof createCandidate>): Promise<StagingResult> {
  const controller = container.state('supervisor').get('controller');
  if (controller && !controller.wantsRunning(pkgFolder)) return { ok: false, pkg: pkgFolder, checks: [], error: 'Package stopped; use start explicitly' };
  const pkg = container.registry.getPackage(pkgFolder);
  if (pkg?.isolated !== true && pkg?.runtime?.mode !== 'isolated') return stagePackageCandidate(container, pkgFolder, expectedCandidate);
  const previous = getIsolatedRunner(container, pkgFolder);
  // Candidate lookups are local to this async operation. Live requests retain the old runner.
  const candidate = await isolatedRunnerFor(container, pkg, false);
  if (!candidate) throw new Error('Isolated candidate unavailable');
  try {
    const result = await withStagedIsolated(container, pkgFolder, candidate, () => stagePackageCandidate(container, pkgFolder, expectedCandidate));
    if (result.ok) {
      container.state('isolated').set(pkgFolder, candidate);
      await previous?.stop('replaced');
    } else {
      await candidate.stop('candidate_rejected');
      if (!previous?.running) container.registry.setState(pkgFolder, 'failed', result.error);
    }
    return result;
  } catch (error) { await candidate.stop('candidate_failed'); throw error; }
}

async function stagePackageCandidate(container: Container, pkgFolder: string, expectedCandidate?: ReturnType<typeof createCandidate>): Promise<StagingResult> {
  const pkg = container.registry.getPackage(pkgFolder);
  const stability = pkg?.runtime?.stability ?? {};
  const timeout = stability.timeout ?? DEFAULT_TIMEOUT;
  const checks: StagingResult['checks'] = [];

  const root = path.join(container.workspace, pkgFolder);
  let candidate: ReturnType<typeof createCandidate>;
  try { candidate = expectedCandidate || createCandidate(root); }
  catch (error: any) { return fail(container, pkgFolder, checks, error.message); }
  container.registry.setState(pkgFolder, 'staging');
  await container.bus.emit('reload:staging', { pkg: pkgFolder });

  let candidateContract;
  try {
    normalizeMonitor(stability.monitor);
    candidateContract = normalizePackageContract(pkg);
    checks.push({ name: 'contract:valid', ok: true, detail: candidateContract.hash });
  } catch (err: any) {
    checks.push({ name: 'contract:valid', ok: false, detail: err.message });
    return fail(container, pkgFolder, checks, err.message);
  }

  const activeContract = container.registry.getActiveContract(pkgFolder);
  if (activeContract) {
    const authorityDiff = diffPackageAuthority(activeContract.contract, candidateContract.contract);
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
      if (!ok) return fail(container, pkgFolder, checks, 'authority expansion requires an exact hash-bound approval');
    }
  }

  try {
    const wiring = await validatePackageWiring(container, pkg);
    checks.push({ name: 'contract:capabilities', ok: true, detail: `${wiring.tools} tool(s), ${wiring.hooks} hook(s)` });
  } catch (err: any) {
    checks.push({ name: 'contract:capabilities', ok: false, detail: err.message });
    return fail(container, pkgFolder, checks, err.message);
  }

  // Fresh scan — the ghost must reflect the NEW code, not the cache.
  const folderPath = resolveAgentFolder(pkgFolder);
  if (folderPath) scanCache.invalidatePrefix(folderPath);

  // ── 1. Ghost router: does the new code even load and mount? ──────────────
  const ghost = express.Router();
  let mounted: any[] = [];
  try {
    mounted = await externalApi<any>(container, 'http').mountPackageRoutes(pkg, ghost);
    checks.push({ name: 'routes:mount', ok: true, detail: `${mounted.length} route(s)` });
  } catch (err: any) {
    checks.push({ name: 'routes:mount', ok: false, detail: err.message });
    return fail(container, pkgFolder, checks, err.message);
  }

  // ── 2. Tools: schemas load, vital tools exist ─────────────────────────────
  if (stability.tools) {
    try {
      const tools = await registerTools(pkgFolder);
      if (stability.tools === 'all') {
        checks.push({ name: 'tools:all', ok: true, detail: `${tools.length} tool(s) loaded` });
      } else if (Array.isArray(stability.tools)) {
        const names = new Set(tools.map((t: any) => t.name));
        const missing = stability.tools.filter((n: string) => !names.has(n));
        const ok = missing.length === 0;
        checks.push({ name: 'tools:vital', ok, detail: ok ? 'all vital tools present' : `missing: ${missing.join(', ')}` });
        if (!ok) return fail(container, pkgFolder, checks, `vital tools missing: ${missing.join(', ')}`);
      }
    } catch (err: any) {
      checks.push({ name: 'tools:load', ok: false, detail: err.message });
      return fail(container, pkgFolder, checks, err.message);
    }
  }

  // ── 3. Route smoke tests (in-process, on the ghost) ───────────────────────
  for (const routeName of (stability.routes || [])) {
    const route = mounted.find((r: any) => r.path === routeName) ?? { method: 'get', path: routeName };
    const status = await smokeDispatch(ghost, route.method || 'get', `/${pkgFolder}/${routeName}`, timeout);
    const ok = status >= 200 && status < 400;
    checks.push({ name: `smoke:${routeName}`, ok, detail: `status ${status || 'timeout'}` });
    if (!ok) return fail(container, pkgFolder, checks, `smoke test "${routeName}" returned ${status || 'timeout'}`);
  }

  // ── 4. Packages may veto the swap (reload:validating) ─────────────────────
  const verdict = await container.bus.veto('reload:validating', { pkg: pkgFolder, checks });
  if (!verdict.allowed) {
    checks.push({ name: 'veto', ok: false, detail: `${verdict.by}: ${verdict.reason ?? 'vetoed'}` });
    return fail(container, pkgFolder, checks, `swap vetoed by ${verdict.by}`);
  }

  try {
    if (candidateHash(root) !== candidate.candidateHash) throw new Error('Candidate changed during staging');
    checks.push({ name: 'candidate:unchanged', ok: true, detail: candidate.candidateHash });
  } catch (error: any) {
    checks.push({ name: 'candidate:unchanged', ok: false });
    return fail(container, pkgFolder, checks, error.message);
  }

  try {
    container.eventContracts.replaceOwner(pkgFolder, candidateContract.contract.provides.eventSchemas);
  } catch (err: any) {
    checks.push({ name: 'events:contracts', ok: false, detail: err.message });
    return fail(container, pkgFolder, checks, err.message);
  }

  // ── 5. Atomic swap ────────────────────────────────────────────────────────
  const http = externalApi<any>(container, 'http');
  const live = http.getOrCreateRouter(pkgFolder);
  live.stack = ghost.stack;                    // single assignment — atomic swap
  http.replaceRegisteredPublicRoutes(pkgFolder, mounted);
  await externalApi<any>(container, 'hooks').wirePackageHooks(pkg); // remove old owner subs, add new
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

function fail(container: Container, pkgFolder: string, checks: any[], error: string): StagingResult {
  container.registry.setState(pkgFolder, 'active'); // old version keeps serving
  container.log(`[stabilizer] "${pkgFolder}" staging FAILED (old version still live): ${error}`);
  return { ok: false, pkg: pkgFolder, checks, error };
}
