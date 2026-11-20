import { createShellControllers } from '../../views/controllers/index.js';
import { createShellLifecycle } from '../../views/controllers/shell_lifecycle.js';

// Exercise the production composition with live state, including initially
// undefined Svelte reactive variables. Optional browser services remain lazy.
export function createShellController(state) {
  const descriptors = new Proxy({}, {
    getOwnPropertyDescriptor: (_, key) => ({
      configurable: true, enumerable: true,
      get: () => state[key], set: value => { state[key] = value; },
    }),
  });
  return createShellControllers({state: descriptors, services: state});
}

export function createMountController(state) {
  return createShellLifecycle({state, deps:state}).mountShell;
}
