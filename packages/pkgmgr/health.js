// Read-only composite health. Its individual checks are intentionally exposed
// so callers can distinguish an unavailable host from an inconsistent local
// runtime and decide whether a retry is safe.

import { existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';

function check(name, ok, detail, severity = 'critical') { return { name, ok: Boolean(ok), severity, detail }; }

export function createOperationalHealthcheck({ environments, runtime, driver = {} } = {}) {
  if (!environments || typeof environments.get !== 'function') throw new Error('An Environment store is required');
  if (!runtime || typeof runtime.readLockfile !== 'function') throw new Error('A Package Runtime is required');

  return {
    async check({ environmentId } = {}) {
      const checks = [];
      let environment;
      try {
        environment = environments.get(environmentId);
        checks.push(check('environment', !['failed', 'deleted'].includes(environment.state), { id: environment.id, state: environment.state }));
      } catch (error) {
        checks.push(check('environment', false, { error: error instanceof Error ? error.message : String(error) }));
      }

      const lockfile = runtime.readLockfile();
      const lockfileValid = typeof lockfile.fingerprint === 'string' && /^sha256:[a-f0-9]{64}$/.test(lockfile.fingerprint);
      checks.push(check('runtime-lockfile', lockfileValid, { generation: lockfile.generation, fingerprint: lockfile.fingerprint ?? null }));

      const missing = Object.keys(lockfile.packages ?? {}).filter(packageName => {
        const active = join(runtime.paths.active, packageName);
        try { return !existsSync(active) || !lstatSync(active).isSymbolicLink(); } catch { return true; }
      });
      checks.push(check('active-releases', missing.length === 0, { expected: Object.keys(lockfile.packages ?? {}).length, missing }));

      try {
        const detail = typeof driver.health === 'function' ? await driver.health({ environment }) : { ok: true, skipped: true };
        checks.push(check('driver', detail?.ok !== false, detail, 'warning'));
      } catch (error) {
        checks.push(check('driver', false, { error: error instanceof Error ? error.message : String(error) }, 'warning'));
      }
      const ok = checks.every(entry => entry.ok || entry.severity !== 'critical') && checks.find(entry => entry.name === 'driver')?.ok !== false;
      return { ok, status: ok ? 'healthy' : 'degraded', checkedAt: new Date().toISOString(), environment, checks };
    },
  };
}
