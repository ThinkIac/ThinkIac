// Test adapter for the database capability. The implementation intentionally
// lives outside Lógos; tests use the same narrow host ports it receives at
// runtime instead of importing a removed internal module.
import { createRequire } from 'node:module';
import { createRuntimeContext } from '../src/kernel/context';
import { composePackageSchema } from '../src/database/schema-composer';
import { appendLog } from '../src/kernel/debug-log';
import { currentAuthority } from '../src/kernel/authority-context';
import { PrivateVault, openSqlCipherDatabase } from '../src/vault/private-vault';

const require = createRequire(import.meta.url);
const { createDatabase } = require('../../modules/db');

export function createDb(overrides: Record<string, any> = {}) {
  return createDatabase({
    applicationRoot: () => process.cwd(),
    dataDir: () => process.env.LOGOS_DATA_DIR,
    composeSchema: composePackageSchema,
    appendLog,
    currentAuthority,
    createVault: (config: any) => new PrivateVault(config),
    openPrivateDatabase: openSqlCipherDatabase,
    log: () => {},
    createContext: createRuntimeContext,
    ...overrides,
  });
}

export function installDb(container: any, db = createDb()) {
  db.install({
    state: (namespace: string) => container.state(namespace),
    bus: container.bus,
    registry: container.registry,
    config: container.config,
  });
  container.state('external-api').set('db', Object.freeze(db));
  return db;
}
