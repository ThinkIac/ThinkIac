











import { dispatchBuiltin } from './builtin_tools.js'
import { invokeTool } from './registry.js'




class MicroWorker {
  /**
   * @param {string} toolName - Nome da tool a executar
   * @param {Object} args - Argumentos da tool
   * @param {Object} options
   * @param {number} options.timeout - Timeout em ms (padrão: 30000)
   * @param {string} options.sessionId - Session ID para contexto
   * @param {Object} options.metadata - Metadados adicionais para log
   */
  constructor(toolName, args, options = {}) {
    this.toolName = toolName
    this.args = args
    this.timeout = options.timeout ?? 30000
    this.sessionId = options.sessionId
    this.metadata = options.metadata ?? {}
    this.startedAt = null
    this.duration = null
  }

  /**
   * Executa a tool com timeout.
   * @returns {Promise<{success: boolean, result: any, error: string|null, duration: number, toolName: string, workerId: string}>}
   */
  async run() {
    this.startedAt = Date.now()
    const workerId = `${this.toolName}_${Math.random().toString(36).slice(2, 8)}`

    try {
      const result = await Promise.race([
        this._execute(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`[Micro] Timeout: "${this.toolName}" excedeu ${this.timeout}ms`)), this.timeout)
        ),
      ])

      this.duration = Date.now() - this.startedAt
      return {
        success: true,
        result,
        error: null,
        duration: this.duration,
        toolName: this.toolName,
        workerId,
      }
    } catch (e) {
      this.duration = Date.now() - this.startedAt
      return {
        success: false,
        result: null,
        error: e.message,
        duration: this.duration,
        toolName: this.toolName,
        workerId,
      }
    }
  }

  async _execute() {
    
    let result = await dispatchBuiltin(this.toolName, this.args)
    if (result === null) {
      result = await invokeTool(this.toolName, this.args)
    }
    return result
  }
}




export class MicroManager {
  /**
   * @param {Object} options
   * @param {number} options.concurrencyLimit - Máximo de workers simultâneos (padrão: 5)
   * @param {number} options.defaultTimeout - Timeout padrão por worker em ms (padrão: 30000)
   * @param {boolean} options.verbose - Log detalhado (padrão: false)
   */
  constructor(options = {}) {
    this.concurrencyLimit = options.concurrencyLimit ?? 5
    this.defaultTimeout = options.defaultTimeout ?? 30000
    this.verbose = options.verbose ?? false
    this._progressCallback = null
    this._executionLog = []
  }

  /**
   * Registra callback de progresso.
   * @param {Function} fn - (completed, total, workerResult) => void
   */
  onProgress(fn) {
    this._progressCallback = fn
  }

  /**
   * Executa uma única tool atômica.
   * Atalho para quando só precisa de 1 worker.
   *
   * @param {string} toolName
   * @param {Object} args
   * @param {Object} options
   * @returns {Promise<Object>} resultado do worker
   */
  async execute(toolName, args, options = {}) {
    const worker = new MicroWorker(toolName, args, {
      timeout: options.timeout ?? this.defaultTimeout,
      sessionId: options.sessionId,
      metadata: options.metadata,
    })
    const result = await worker.run()
    this._logExecution(result)
    return result
  }

  /**
   * Executa múltiplas tools em paralelo com limite de concorrência.
   *
   * @param {Array<{toolName: string, args: Object, options?: Object}>} workItems
   * @returns {Promise<Array<Object>>} resultados dos workers
   */
  async executeAll(workItems) {
    if (!workItems || workItems.length === 0) return []

    const results = []
    const total = workItems.length
    let completed = 0

    this._log(`[Micro] executeAll: ${total} work item(s), concorrência=${this.concurrencyLimit}`)

    
    for (let i = 0; i < total; i += this.concurrencyLimit) {
      const batch = workItems.slice(i, i + this.concurrencyLimit)
      const batchResults = await Promise.all(
        batch.map(item => {
          const worker = new MicroWorker(item.toolName, item.args, {
            timeout: item.options?.timeout ?? this.defaultTimeout,
            sessionId: item.options?.sessionId,
            metadata: item.options?.metadata,
          })
          return worker.run()
        })
      )

      for (const result of batchResults) {
        completed++
        results.push(result)
        this._logExecution(result)
        if (this._progressCallback) {
          this._progressCallback(completed, total, result)
        }
      }
    }

    
    const successCount = results.filter(r => r.success).length
    const totalDuration = results.reduce((acc, r) => acc + r.duration, 0)
    this._log(`[Micro] executeAll concluído: ${successCount}/${total} sucesso, ${(totalDuration / total).toFixed(0)}ms média`)

    return results
  }

  /**
   * Retorna o log de execução para debug.
   */
  getExecutionLog() {
    return this._executionLog
  }

  /**
   * Limpa o log de execução.
   */
  clearExecutionLog() {
    this._executionLog = []
  }

  /**
   * Retorna estatísticas resumidas.
   */
  stats() {
    const logs = this._executionLog
    return {
      totalExecutions: logs.length,
      successCount: logs.filter(l => l.success).length,
      failureCount: logs.filter(l => !l.success).length,
      averageDuration: logs.length > 0
        ? (logs.reduce((acc, l) => acc + l.duration, 0) / logs.length).toFixed(0)
        : 0,
      concurrencyLimit: this.concurrencyLimit,
      toolsUsed: [...new Set(logs.map(l => l.toolName))],
    }
  }

  

  _logExecution(result) {
    this._executionLog.push({
      ...result,
      timestamp: new Date().toISOString(),
    })
    if (this.verbose) {
      const status = result.success ? '✅' : '❌'
      console.log(`${status} [Micro] ${result.toolName} (${result.workerId}) — ${result.duration}ms${result.error ? ': ' + result.error : ''}`)
    }
  }

  _log(msg) {
    if (this.verbose) console.log(msg)
  }
}



let _microManagerInstance = null

/**
 * Retorna instância singleton do MicroManager.
 * @param {Object} options - Opções (só aplicadas na primeira inicialização)
 * @returns {MicroManager}
 */
export function getMicroManager(options = {}) {
  if (!_microManagerInstance) {
    _microManagerInstance = new MicroManager({
      concurrencyLimit: options.concurrencyLimit ?? 5,
      defaultTimeout: options.defaultTimeout ?? 30000,
      verbose: options.verbose ?? false,
    })
  }
  return _microManagerInstance
}

/**
 * Atalho: executa uma única tool via MicroManager.
 * @param {string} toolName
 * @param {Object} args
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export async function microExecute(toolName, args, options = {}) {
  const mm = getMicroManager()
  return mm.execute(toolName, args, options)
}

/**
 * Atalho: executa múltiplas tools em paralelo via MicroManager.
 * @param {Array<{toolName: string, args: Object, options?: Object}>} workItems
 * @returns {Promise<Array<Object>>}
 */
export async function microExecuteAll(workItems) {
  const mm = getMicroManager()
  return mm.executeAll(workItems)
}
