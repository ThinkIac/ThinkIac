import { describe, expect, it } from 'vitest';
import { discoverExternalRuntimeModules } from '../src/kernel/external-modules';

describe('external capability discovery', () => {
  it('loads runtime capabilities but never treats transport libraries as runtime modules', () => {
    const modules = discoverExternalRuntimeModules();
    expect(modules).toEqual(expect.arrayContaining(['http', 'hooks', 'legacy-entry', 'repo', 'svelte', 'websocket-runtime']));
    expect(modules).not.toContain('websocket');
    expect(modules).not.toContain('process-bridge');
  });
});
