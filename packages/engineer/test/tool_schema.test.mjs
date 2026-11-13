import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerTools } from 'logos'
import { patchFile } from '../index.js'

const tools = await registerTools(new URL('..', import.meta.url).pathname)

function schemaFor(name) {
  const tool = tools.find(candidate => candidate.name === name)
  assert.ok(tool, `tool ${name} should be registered`)
  return tool.parameters
}

test('patch_file exposes its required patch arguments', () => {
  const schema = schemaFor('patch_file')
  assert.deepEqual(Object.keys(schema.properties).sort(), ['new_str', 'old_str', 'path', 'skip_validation'])
  assert.deepEqual(schema.required.sort(), ['new_str', 'old_str', 'path'])
})

test('run_shell exposes the command argument', () => {
  const schema = schemaFor('run_shell')
  assert.deepEqual(Object.keys(schema.properties).sort(), ['command', 'confirm', 'cwd', 'timeout'])
  assert.deepEqual(schema.required, ['command'])
})

test('observation tools expose compatible pagination controls', () => {
  assert.deepEqual(Object.keys(schemaFor('read_file').properties).sort(), ['max_bytes', 'max_lines', 'path', 'start_line'])
  assert.deepEqual(Object.keys(schemaFor('list_dir').properties).sort(), ['depth', 'filter', 'limit', 'offset', 'path', 'sizes'])
  assert.deepEqual(Object.keys(schemaFor('search_code').properties).sort(), ['file_pattern', 'max_results', 'offset', 'path', 'query'])
})

test('SWE workflow inspection tools are registered read-only contracts', () => {
  assert.ok(schemaFor('workspace_baseline'))
  assert.ok(schemaFor('resolve_validation'))
  assert.deepEqual(Object.keys(schemaFor('isolate_workspace').properties).sort(), ['destination', 'path', 'revision', 'task_id'])
  assert.deepEqual(schemaFor('inspect_isolated_workspace').required, ['path', 'source_path'])
})

test('patch_file blocks paths outside the exact write roots', async () => {
  await assert.rejects(
    patchFile({
      path: '/root/code/ThinkIac/packages/logos-escape/file.ts',
      old_str: 'before',
      new_str: 'after',
    }),
    /Escrita bloqueada fora do projeto/,
  )
})

test('patch_file does not follow an allowed symlink to an external path', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'engineer-write-root-'))
  const link = join(new URL('..', import.meta.url).pathname, 'write-root-link')
  try {
    await symlink(temp, link)
    await assert.rejects(
      patchFile({
        path: join(link, 'file.js'),
        old_str: 'before',
        new_str: 'after',
      }),
      /Escrita bloqueada fora do projeto|não encontrado/i,
    )
  } finally {
    await rm(link, { force: true })
    await rm(temp, { recursive: true, force: true })
  }
})
