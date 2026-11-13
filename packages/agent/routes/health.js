import fs from 'node:fs';

export function runtimeHealth() {
  /**
   * @register_router health
   * @method GET
   */
  let version = 'unknown';
  try { version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || version; } catch {}
  return {
    ok: true,
    package: 'agent',
    version,
    contracts: ['chat/send', 'chat/replay', 'websocket'],
  };
}
