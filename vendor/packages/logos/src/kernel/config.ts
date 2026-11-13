// kernel/config.ts — user-level persisted config (~/.environments/config.json).
// v1-compatible readConfig/saveConfig.

'use strict';

import fs from 'fs';
import path from 'path';
import os from 'os';

function defaultConfigDir(): string {
  return path.join(os.homedir(), '.environments');
}

export function readConfig(configDir = defaultConfigDir()): Record<string, any> {
  const configFile = path.join(configDir, 'config.json');
  if (!fs.existsSync(configFile)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveConfig(update: Record<string, any>, configDir = defaultConfigDir()): void {
  const current = readConfig(configDir);
  for (const key of Object.keys(update)) {
    if (update[key] === null) delete current[key];
    else current[key] = update[key];
  }
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(current, null, 2));
}
