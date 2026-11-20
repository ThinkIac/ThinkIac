#!/usr/bin/env node

const command = process.argv[2];

if (typeof command === 'string' && command.startsWith('engineer:')) {
  await import('../packages/engineer/bin/think-engineer.js');
} else {
  console.error('Comando desconhecido.');
  console.error('Uso:');
  console.error('  think engineer:createPackage <nome>');
  console.error('  think engineer:validatePackage <nome> [--applyAjusts]');
  process.exitCode = 1;
}
