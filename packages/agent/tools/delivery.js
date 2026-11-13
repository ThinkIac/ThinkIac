import { stabilityReceipts } from '../core/stability_receipts.js'

export function getDeliveryEvidence({ sessionId, runId, taskId, pkg } = {}) {
  /**
   * @register_tool get_delivery_evidence
   * @description Consulta alterações locais e recibos de uma execução sem inferir ativação.
   * @param {string} sessionId - Sessão dona da execução
   * @param {string?} runId - Execução consultada
   * @param {string?} taskId - Tarefa consultada
   * @param {string?} pkg - Pacote dos recibos
   */
  if (!sessionId || (!runId && !taskId)) return { success: false, error: 'Informe sessionId e runId ou taskId.' }
  const filter = { sessionId, runId, taskId, pkg }
  return { success: true, changedState: false,
    localChanges: stabilityReceipts.localChanges(filter),
    deliveries: stabilityReceipts.deliveries(filter),
    receipts: stabilityReceipts.list(filter),
  }
}
