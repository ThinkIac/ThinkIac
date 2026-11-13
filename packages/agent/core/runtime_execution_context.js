




import { AsyncLocalStorage } from 'node:async_hooks'

const storage = new AsyncLocalStorage()

export function withRuntimeExecutionContext(context, callback) {
  return storage.run(context || null, callback)
}

export function getRuntimeExecutionContext() {
  return storage.getStore() || null
}
