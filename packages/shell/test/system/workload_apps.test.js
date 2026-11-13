import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const appsSource = fs.readFileSync(path.join(directory, '../../runtime/system/apps/index.js'), 'utf8');

test('Shell não depende do pacote workloads nem do Docker para montar o catálogo nativo', () => {
  assert.doesNotMatch(appsSource, /workloads\/data|selectPublishedWorkloadContainers|dockerode/);
});
