import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSlots } from './llm_keys.js'

test('equipe por relatórios restringe comandos nativos mesmo com pool irrestrito', () => {
  const [slot] = buildSlots({ llm: { pools: [{name:'codex', provider:'codex-cli', enabled:true}] } })
  const args = slot.cli.buildArgs(null, {sandbox:'danger-full-access', approval_policy:'on-request', reportToolsOnly:true}, {transport:'app-server'})
  assert.ok(args.includes('sandbox_mode="read-only"'))
  assert.ok(args.includes('approval_policy="never"'))
  assert.ok(args.includes('features.shell_tool=false'))
  assert.ok(args.includes('features.unified_exec=false'))
})

test('Codex autoriza o workspace selecionado sem perder diretórios extras do pool', () => {
  const [slot] = buildSlots({
    llm: {
      pools: [{
        name: 'codex', provider: 'codex-cli', enabled: true,
        cli: { add_dirs: ['/opt/thinkiac'] },
      }],
    },
  })

  const args = slot.cli.buildArgs(null, slot.cli.opts, {
    workspaceDir: '/root/code/ThinkIac',
  })
  const writableDirs = args
    .flatMap((arg, index) => arg === '--add-dir' ? [args[index + 1]] : [])

  assert.deepEqual(writableDirs, ['/opt/thinkiac', '/root/code/ThinkIac'])
})

test('Codex não duplica o workspace quando ele já está configurado no pool', () => {
  const [slot] = buildSlots({
    llm: {
      pools: [{
        name: 'codex', provider: 'codex-cli', enabled: true,
        cli: { add_dirs: ['/root/code/ThinkIac'] },
      }],
    },
  })

  const args = slot.cli.buildArgs(null, slot.cli.opts, {
    workspaceDir: '/root/code/ThinkIac',
  })
  const writableDirs = args
    .flatMap((arg, index) => arg === '--add-dir' ? [args[index + 1]] : [])

  assert.deepEqual(writableDirs, ['/root/code/ThinkIac'])
})

test('Codex preserva danger-full-access explícito', () => {
  const [slot] = buildSlots({
    llm: {
      pools: [{
        name: 'codex', provider: 'codex-cli', enabled: true,
        cli: { sandbox: 'danger-full-access', network: true },
      }],
    },
  })

  const args = slot.cli.buildArgs(null, slot.cli.opts, {})
  const sandboxAt = args.indexOf('--sandbox')

  assert.ok(sandboxAt >= 0)
  assert.equal(args[sandboxAt + 1], 'danger-full-access')
  assert.equal(args.includes('sandbox_workspace_write.network_access=true'), false)
})

import { resolveCodexPermissions, resolveCodexExecutionMode } from './codex_permissions.js'

test('Codex é controlado pelo Runtime por padrão e só libera tools nativas em modo explícito', () => {
  const [slot] = buildSlots({ llm: { pools: [{ name: 'codex', provider: 'codex-cli', enabled: true }] } })
  const controlled = slot.cli.buildArgs(null, slot.cli.opts, { transport: 'app-server' })
  const native = slot.cli.buildArgs(null, { ...slot.cli.opts, execution_mode: 'codex-native' }, { transport: 'app-server' })
  assert.equal(resolveCodexExecutionMode({}), 'runtime-controlled')
  assert.equal(resolveCodexExecutionMode({ execution_mode: 'codex-native' }), 'codex-native')
  assert.ok(controlled.includes('features.shell_tool=false'))
  assert.ok(controlled.includes('features.unified_exec=false'))
  assert.equal(native.includes('features.shell_tool=false'), false)
  assert.throws(() => resolveCodexExecutionMode({ execution_mode: 'other' }), /Modo de execução/)
})

for (const sandbox of ['auto', 'read-only', 'workspace-write', 'danger-full-access']) {
  test(`sandbox ${sandbox} observável no processo`, () => {
    const [slot] = buildSlots({ llm: { pools: [{ name: 'codex', provider: 'codex-cli', enabled: true, cli: { sandbox } }] } })
    const args = slot.cli.buildArgs(null, slot.cli.opts, { transport: 'app-server', workspaceDir: '/workspace' })
    assert.equal(args[0], 'app-server')
    assert.ok(args.includes(`sandbox_mode="${sandbox === 'auto' ? 'workspace-write' : sandbox}"`))
    assert.ok(args.includes('approval_policy="on-request"'))
  })
}
for (const approval_policy of ['never', 'on-request']) {
  test(`Approval ${approval_policy} propagada`, () => {
    assert.equal(resolveCodexPermissions({ approval_policy }).approvalPolicy, approval_policy)
  })
}
for (const legacy of ['untrusted', 'on-failure']) {
  for (const key of ['approval_policy', 'approvalPolicy', 'approval_mode', 'ask_for_approval']) {
    test(`${key} legado ${legacy} usa aprovação suportada`, () => {
      assert.equal(resolveCodexPermissions({ [key]: legacy }).approvalPolicy, 'on-request')
    })
  }
}
for (const mode of ['manual', 'semi', 'interactive']) {
  for (const transport of ['exec', 'app-server']) {
    test(`${mode} inicia ${transport} com política suportada`, () => {
      const [slot] = buildSlots({ llm: { pools: [{ name: 'codex', provider: 'codex-cli', enabled: true }] } })
      const args = slot.cli.buildArgs(null, slot.cli.opts, { transport, sessionPolicy: { mode } })
      assert.ok(args.includes('approval_policy="on-request"'))
      assert.equal(args.some(arg => arg.includes('untrusted')), false)
    })
  }
}
test('auto da sessão ignora preset read_only inativo, mas preserva sandbox explícito', () => {
  const policy = { mode: 'auto', preset: 'read_only', updatedAt: '2026-01-01' }
  assert.deepEqual(resolveCodexPermissions({}, policy), { sandbox: 'workspace-write', approvalPolicy: 'on-request' })
  assert.equal(resolveCodexPermissions({ sandbox: 'danger-full-access' }, policy).sandbox, 'danger-full-access')
  assert.equal(resolveCodexPermissions({}, { ...policy, mode: 'semi' }).sandbox, 'read-only')
  assert.equal(resolveCodexPermissions({ approval_policy: 'never' }, { ...policy, mode: 'manual' }).approvalPolicy, 'never')
})
test('valores inválidos não são convertidos silenciosamente', () => {
  assert.throws(() => resolveCodexPermissions({ sandbox: 'typo' }), /Sandbox/)
  assert.throws(() => resolveCodexPermissions({ approval_policy: 'typo' }), /Approval/)
})
test('App Server preserva diretórios, rede e configuração MCP da sessão', () => {
  const [slot] = buildSlots({ llm: { pools: [{ name: 'codex', provider: 'codex-cli', enabled: true,
    cli: { add_dirs: ['/extra', '/workspace'], network: true } }] } })
  const args = slot.cli.buildArgs(null, slot.cli.opts, { transport: 'app-server', workspaceDir: '/workspace',
    mcpEnv: { AGENT_SESSION_ID: 'session-test', THINKIAC_MCP_TOKEN: 'test-token' } })
  assert.ok(args.includes('sandbox_workspace_write.writable_roots=["/extra","/workspace"]'))
  assert.ok(args.includes('sandbox_workspace_write.network_access=true'))
  assert.ok(args.some(arg => arg.includes('AGENT_SESSION_ID="session-test"')))
  assert.ok(args.some(arg => arg.includes('THINKIAC_MCP_TOKEN="test-token"')))
})
