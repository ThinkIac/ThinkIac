
export function resolveCodexPermissions(opts = {}, policy = null) {
  const mode = opts.permission_policy ?? opts.permissions ?? opts.permission_mode ?? policy?.mode ?? 'auto'
  const sandbox = opts.sandbox && opts.sandbox !== 'auto'
    ? opts.sandbox
    : policy?.updatedAt && policy.mode === 'semi' && policy.preset === 'read_only'
      ? 'read-only' : 'workspace-write'
  const approval = opts.approval_policy ?? opts.approvalPolicy ?? opts.approval_mode ?? opts.ask_for_approval
  const approvalPolicy = !approval || approval === 'auto'
    ? ['allow', 'off'].includes(mode) ? 'never' : 'on-request'
    
    : ['untrusted', 'on-failure'].includes(approval) ? 'on-request' : approval
  if (!['read-only', 'workspace-write', 'danger-full-access'].includes(sandbox)) throw new Error(`Sandbox Codex inválido: ${sandbox}`)
  if (!['on-request', 'never'].includes(approvalPolicy)) throw new Error(`Approval Codex inválido: ${approvalPolicy}`)
  return { sandbox, approvalPolicy }
}




export function resolveCodexExecutionMode(opts = {}) {
  const mode = opts.execution_mode ?? opts.executionMode ?? 'runtime-controlled'
  if (!['runtime-controlled', 'codex-native'].includes(mode)) {
    throw new Error(`Modo de execução Codex inválido: ${mode}`)
  }
  return mode
}
