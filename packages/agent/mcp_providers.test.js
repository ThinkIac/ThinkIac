import test from 'node:test'
import assert from 'node:assert/strict'
import { listMcpProviders } from './mcp_providers.js'

test('MCP provider keeps API keys out of public responses', async () => {
  for (const provider of listMcpProviders()) {
    assert.equal(Object.hasOwn(provider, 'api_key'), false)
    assert.match(provider.virtualPackage, /^mcp-[a-z0-9-]+$/)
  }
})
