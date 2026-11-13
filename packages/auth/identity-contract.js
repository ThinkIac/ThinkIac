// Compatibility entrypoint. Auth's canonical identity implementation lives
// under runtime so HTTP, MCP and third-party adapters share one contract.
export * from './runtime/identity.js';
