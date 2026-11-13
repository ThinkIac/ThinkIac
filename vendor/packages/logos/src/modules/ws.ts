// Logos adapter for the reusable WebSocket transport.
'use strict';

import fs from 'fs';
import path from 'path';
import { Container, LogosModule } from '../kernel/container';
import { registerRoutes as scanRoutes } from '../kernel/scan';
import { createRuntimeContext } from '../kernel/context';
import { runAsPackage } from '../kernel/authority-context';

function loadWebsocketModule(): { WsHub: new () => any } {
  const candidates = [
    path.resolve(__dirname, '../../../modules/websocket'),
    path.resolve(__dirname, '../../../../modules/websocket'),
  ];
  for (const candidate of candidates) if (fs.existsSync(candidate)) return require(candidate);
  throw new Error('[logos] required built-in module "websocket" was not found');
}

// The public transport belongs to packages/modules/websocket; Logos only wires
// its container, package authority and @stream route lifecycle to that hub.
const { WsHub } = loadWebsocketModule();

export function getHub(container: Container): InstanceType<typeof WsHub> {
  let hub = container.state('ws').get('hub');
  if (!hub) {
    hub = new WsHub();
    container.state('ws').set('hub', hub);
  }
  return hub;
}

async function mountStreamRoutes(container: Container, pkg: any) {
  const hub = getHub(container);
  if (!hub.wss) return;

  let routes: any[] = [];
  try { routes = await scanRoutes(pkg.folder); } catch { return; }

  const dropped = hub.offOwner(pkg.folder);
  if (dropped) container.log(`[ws] ${pkg.folder}: ${dropped} handler(s) da versão anterior removidos`);
  const scope = container.getPackageScope(pkg.folder) ??
    container.createPackageScope(pkg.folder, String(Date.now()));

  for (const route of routes.filter(r => r.stream)) {
    const channel = route.channel || route.path;
    hub.onMessage(channel, async (msg: any, ws: any, sessionId: string) => {
      await runAsPackage(container.authority, pkg.folder, async () => {
        const context = createRuntimeContext({ pkg, sessionId, ws, osChannel: channel });
        try { await route.handler(ws, context, msg); }
        catch (err: any) { container.log(`[ws] error on ${channel}: ${err.message}`); }
      });
    }, { owner: pkg.folder, scope });
    container.log(`${pkg.name ?? pkg.folder} registered [WS:${route.direction}] /${pkg.folder}/${route.path}`);
  }
}

export const wsModule: LogosModule = {
  name: 'ws',
  phase: 'wire',
  swappable: false,
  install(container: Container) {
    container.bus.on('package:wiring', (payload: any) => mountStreamRoutes(container, payload.pkg), { priority: 60 });
    container.bus.on('reload:streams', (payload: any) => mountStreamRoutes(container, payload.pkg), { priority: 60 });
  },
};
