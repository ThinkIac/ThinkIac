import { currentAuthority } from './authority-context';
import type { AccessController } from './access-controller';

export type PackageFaultSource = 'uncaughtException' | 'unhandledRejection';
export type PackageFaultHandler = (folder: string, error: unknown, source: PackageFaultSource) => void;

const handlers = new Map<AccessController, PackageFaultHandler>();
let installed = false;

function fatal(error: unknown): never {
  const detail = error instanceof Error ? error.stack || error.message : String(error);
  try { process.stderr.write('[logos:fatal] unowned runtime failure: ' + detail + '\n'); } catch { /* stderr may be unavailable */ }
  process.exit(1);
}

function dispatch(source: PackageFaultSource, error: unknown): void {
  const context = currentAuthority();
  const handler = context.access ? handlers.get(context.access) : undefined;
  if (context.principal.kind !== 'package' || !handler) fatal(error);
  try {
    handler(context.principal.id, error, source);
  } catch (recoveryError) {
    fatal(recoveryError);
  }
}

const onUncaughtException = (error: Error) => dispatch('uncaughtException', error);
const onUnhandledRejection = (reason: unknown) => dispatch('unhandledRejection', reason);

function install(): void {
  if (installed) return;
  installed = true;
  process.prependListener('uncaughtException', onUncaughtException);
  process.prependListener('unhandledRejection', onUnhandledRejection);
}

/** Route otherwise fatal async failures to the owning package's recovery path. */
export function registerPackageFaultRecovery(access: AccessController, handler: PackageFaultHandler): () => void {
  handlers.set(access, handler);
  install();
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    handlers.delete(access);
    if (handlers.size) return;
    process.removeListener('uncaughtException', onUncaughtException);
    process.removeListener('unhandledRejection', onUnhandledRejection);
    installed = false;
  };
}
