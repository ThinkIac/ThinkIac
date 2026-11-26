#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureInstance, parseArgs } from '../launcher/instance.mjs';

const base = fileURLToPath(new URL('..', import.meta.url));
try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Uso: thinkiac [--name nome] [--profile default|arquivo.json] [--port porta] [--mcp-port porta] [--admin-email email] [--install-only]');
  } else {
    const { home, config, profileFile } = await configureInstance({ cwd: process.cwd(), base, ...options });
    Object.assign(process.env, {
      THINKIAC_HOME: home,
      DOTENV_CONFIG_PATH: path.join(home, '.env'),
      PORT: String(config.port),
      MCP_PORT: String(config.mcpPort),
      HOST: '127.0.0.1',
      MCP_HOST: '127.0.0.1',
    });
    for (const key of ['LOGOS_DATA_DIR', 'INITIAL_AUTH_USER', 'INITIAL_AUTH_EMAIL', 'INITIAL_AUTH_PASSWORD', 'INITIAL_AUTH_NAME']) {
      delete process.env[key];
    }
    process.argv = [process.execPath, path.join(base, 'index.js'), '--profile', profileFile,
      ...(options.installOnly ? ['--install-only'] : [])];
    await import('../index.js');
  }
} catch (error) {
  console.error(`[thinkiac] ${error.message}`);
  process.exitCode = 1;
}
