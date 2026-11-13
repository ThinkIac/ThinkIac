#!/usr/bin/env node
'use strict';

// Auditable systemd entrypoint. It keeps secrets out of the unit and replaces
// the migration-only Python launcher without introducing PM2 as a dependency.
const fs = require('node:fs');
const path = require('node:path');

function fail(message) {
  console.error(`[logos-supervisor] ${message}`);
  process.exitCode = 1;
}

async function main(argv = process.argv.slice(2)) {
  const rootIndex = argv.indexOf('--root');
  if (rootIndex === -1 || !argv[rootIndex + 1] || argv.length !== 2) return fail('usage: systemd-entry --root <workspace>');
  const root = path.resolve(argv[rootIndex + 1]);
  const envFile = process.env.LOGOS_SUPERVISOR_ENV_JSON;
  if (envFile) {
    let stat;
    try { stat = fs.statSync(envFile); } catch (error) { return fail(`cannot read environment file: ${error.message}`); }
    if (stat.uid !== process.getuid() || (stat.mode & 0o077)) return fail('environment file must be private and owned by the service user');
    let values;
    try { values = JSON.parse(fs.readFileSync(envFile, 'utf8')); } catch (error) { return fail(`invalid environment file: ${error.message}`); }
    if (!values || typeof values !== 'object' || Array.isArray(values) || Object.entries(values).some(([key, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== 'string')) return fail('invalid environment entries');
    Object.assign(process.env, values);
  }
  process.env.LOGOS_SUPERVISOR_ROOT = root;
  // systemd is already the exclusive process owner.  Running the daemon in
  // this process gives the unit a stable MainPID and avoids an intermediate
  // CLI/flock process being mistaken for a clean supervisor shutdown.
  const { Supervisor } = require('./index.cjs');
  const daemon = new Supervisor(root);
  await daemon.listen();

  await new Promise(resolve => {
    let closing = false;
    const close = () => {
      if (closing) return;
      closing = true;
      daemon.close().catch(error => {
        console.error(`[logos-supervisor] shutdown failed: ${error.message}`);
        process.exitCode = 1;
      }).finally(resolve);
    };
    process.once('SIGTERM', close);
    process.once('SIGINT', close);
  });
}

main().catch(error => fail(error.message));
