// kernel/manifest.ts — auto-generates a machine-readable capability manifest
// for a package.
//
// Every SOTA agent framework has some notion of a package/plugin manifest
// (an MCP server's tool list, a LangChain plugin's schema, a CrewAI tool
// registry) so other tools — a registry, a crew builder, another agent —
// can discover what a package offers without reading its source. Lógos
// packages already declare all of this via @register_tool/@register_hook/
// @register_router/@register_command JSDoc tags, scanned by kernel/scan.ts
// for the runtime's own wiring. This module reuses that exact scan output
// instead of asking package authors to hand-write a second, parallel
// description of the same capabilities (which would drift immediately).

'use strict';

import fs from 'fs';
import path from 'path';
import { registerTools, registerHooks, registerRoutes, registerCommands, resolveAgentFolder } from './scan';

function readPackageJson(folderPath: string): { name?: string; version?: string; description?: string } {
  try {
    return JSON.parse(fs.readFileSync(path.join(folderPath, 'package.json'), 'utf-8'));
  } catch {
    return {};
  }
}

export interface PackageManifest {
  name: string;
  version?: string;
  description?: string;
  tools: { name: string; description: string | null; parameters: any; reach: string; recoveryPolicy: string | null; reconcileTool: string | null }[];
  hooks: { event: string; priority: number }[];
  routes: { path: string; method: string }[];
  commands: { name: string; description: string | null; parameters: any }[];
  generatedAt: string;
}

export async function generateManifest(agentFolder: string): Promise<PackageManifest> {
  const folderPath = resolveAgentFolder(agentFolder);
  if (!folderPath) throw new Error('Folder not found');

  const pkgJson = readPackageJson(folderPath);
  const [tools, hooks, routes, commands] = await Promise.all([
    registerTools(folderPath),
    registerHooks(folderPath),
    registerRoutes(folderPath),
    registerCommands(folderPath),
  ]);

  return {
    name: pkgJson.name || path.basename(folderPath),
    version: pkgJson.version,
    description: pkgJson.description,
    tools: tools.map((t: any) => ({
      name: t.name, description: t.description ?? null, parameters: t.parameters,
      reach: t.reach || 'auto', recoveryPolicy: t.recoveryPolicy || null,
      reconcileTool: t.reconcileTool || null,
    })),
    hooks: hooks.map((h: any) => ({ event: h.event, priority: h.priority })),
    routes: routes.map((r: any) => ({ path: r.path, method: r.method })),
    commands: commands.map((c: any) => ({ name: c.name, description: c.description ?? null, parameters: c.parameters })),
    generatedAt: new Date().toISOString(),
  };
}

// Writes the manifest as <folder>/logos.json and returns the path written.
// Not wired into boot/reload — this is an on-demand snapshot (CLI, kernel
// tool, or a registry's own CI step), not a file the runtime reads back.
export async function writeManifest(agentFolder: string, outFile = 'logos.json'): Promise<string> {
  const folderPath = resolveAgentFolder(agentFolder);
  if (!folderPath) throw new Error('Folder not found');
  const manifest = await generateManifest(folderPath);
  const outPath = path.join(folderPath, outFile);
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  return outPath;
}
