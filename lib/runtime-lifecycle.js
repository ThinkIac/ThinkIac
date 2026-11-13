export function installGracefulShutdown({ processLike = process, dispatch, logger = console } = {}) {
  let stopping = false;

  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    try {
      await dispatch('shutdown', { signal });
      processLike.exit(0);
    } catch (error) {
      logger.error('Runtime shutdown failed:', error);
      processLike.exit(1);
    }
  };

  processLike.once('SIGTERM', shutdown);
  processLike.once('SIGINT', shutdown);
  return shutdown;
}
