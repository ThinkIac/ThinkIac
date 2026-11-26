#!/usr/bin/env node

const command = process.argv[2];

if (typeof command === 'string' && command.startsWith('engineer:')) {
  const { installProfile } = await import('../launcher/profile.mjs');
  const { fileURLToPath, pathToFileURL } = await import('node:url');
  const path = await import('node:path');
  const base = fileURLToPath(new URL('..', import.meta.url));
  const profileFile = process.env.THINKIAC_PROFILE || path.join(base, 'profiles/default.json');
  const installed = await installProfile({ base, profileFile });
  process.chdir(installed.directory);
  await import(pathToFileURL(path.join(installed.directory, 'packages/engineer/bin/think-engineer.js')).href);
} else if (command === 'start' || command === 'profile:install' || command === 'profile:update') {
  if (command !== 'start') process.argv.push('--install-only');
  if (command === 'profile:update') process.argv.push('--update');
  await import('../index.js');
} else {
  console.error('Comando desconhecido.');
  console.error('Uso:');
  console.error('  think engineer:createPackage <nome>');
  console.error('  think engineer:validatePackage <nome> [--applyAjusts]');
  process.exitCode = 1;
}
