// Compatibility shim for consumers that still import the historical name.
// Public provisioning no longer resolves releases through Store: it uses the
// trusted npm/Verdaccio registry and its SHA-512 dist.integrity instead.

import { prepareRegistryReconciliation } from './registry-reconciliation.js';

/** @deprecated Use prepareRegistryReconciliation. */
export async function prepareStoreReconciliation({ manifest, fetchFn = fetch } = {}) {
  return prepareRegistryReconciliation({ manifest, fetchFn });
}
