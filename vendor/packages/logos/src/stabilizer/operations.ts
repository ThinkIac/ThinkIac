import type { Container } from '../kernel/container';

/** One lifecycle operation per package. Nested staging runs inside its caller's lock. */
export function packageOperation<T>(container: Container, folder: string, operation: () => Promise<T>): Promise<T> {
  const locks = container.state('packageOperations');
  const previous = locks.get(folder) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  locks.set(folder, next);
  void next.finally(() => { if (locks.get(folder) === next) locks.delete(folder); }).catch(() => {});
  return next;
}
