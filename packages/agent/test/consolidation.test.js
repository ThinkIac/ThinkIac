import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const agentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = path.resolve(agentDir, '..');
const read = (...parts) => fs.readFileSync(path.join(packagesDir, ...parts), 'utf8');

test('Agent é o único pacote do runtime e contém o adapter de host', () => {
  assert.equal(fs.existsSync(path.join(packagesDir, 'aurora')), false);
  assert.equal(fs.existsSync(path.join(agentDir, 'runtime/index.js')), true);
  assert.equal(fs.existsSync(path.join(agentDir, 'host/logos/index.js')), true);
  assert.equal(fs.existsSync(path.join(agentDir, 'runtime/lib/agent-profile.js')), true);
  assert.equal(fs.existsSync(path.join(packagesDir, 'agent-runtime')), false);
  assert.equal(fs.existsSync(path.join(packagesDir, 'agent-runtime-host-logos')), false);
  assert.doesNotMatch(read('flows', 'index.js'), /\.\.\/agent-runtime\//);
  assert.doesNotMatch(read('specialists', 'index.js'), /\.\.\/agent-runtime\//);
});

test('Auth é o dono canônico de identidade, exposição pública e diálogos', () => {
  const auth = read('auth', 'index.js');
  assert.equal(fs.existsSync(path.join(packagesDir, 'auth/runtime/identity.js')), true);
  assert.equal(fs.existsSync(path.join(packagesDir, 'auth/runtime/public-exposure.js')), true);
  assert.equal(fs.existsSync(path.join(packagesDir, 'auth/views/components/Dialogs.svelte')), true);
  assert.equal(fs.existsSync(path.join(packagesDir, 'identity-runtime')), false);
  assert.doesNotMatch(auth, /identity-runtime|redirect\/core|ui-dialogs/);
});

test('rotas e configuração canônicas não voltam a depender de Aurora', () => {
  assert.doesNotMatch(read('agent', 'index.js'), /\/aurora(?:\/|['"`])/);
  assert.doesNotMatch(read('shell', 'views', 'agents', 'runtime.js'), /aurora/i);
  assert.doesNotMatch(read('shell', 'views', 'agents', 'catalog.js'), /aurora/i);
});
