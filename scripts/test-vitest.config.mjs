// Explicit CLI file selection; do not inherit application or workspace discovery.
export default { test: { include: ['**/*.test.js', '**/*.test.ts'], environment: 'node', globals: true, fileParallelism: false, maxWorkers: 1 } };
