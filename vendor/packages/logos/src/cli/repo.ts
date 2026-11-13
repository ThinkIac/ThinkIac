// cli/repo.ts — `logos repo …`, a plain HTTP client for the auto-repository.
//
// These commands talk to the runtime that is already running, exactly like
// the chat REPL does. They deliberately do NOT boot a second runtime: a
// second one would try to open the same SSH port and would know nothing about
// the branch instances the first one is supervising.

'use strict';

import fs from 'fs';
import http from 'http';
import https from 'https';
import { externalModulePath } from '../kernel/external-modules';
const { slugify } = require(`${externalModulePath('repo')}/transport/paths`);

const DEFAULT_URL = 'http://localhost:5040';

// node:http rather than global fetch: this CLI is expected to work on any
// Node 18+ and in stripped-down containers where the fetch stack is not
// necessarily usable, and the request shapes here are trivial.
function call(base: string, path: string, init: { method?: string; body?: string; token?: string } = {}): Promise<any> {
  const url = new URL(`${base.replace(/\/$/, '')}${path}`);
  const lib = url.protocol === 'https:' ? https : http;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (init.token) headers['x-logos-repo-token'] = init.token;
  if (init.body) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(Buffer.byteLength(init.body));
  }

  return new Promise((resolve, reject) => {
    const req = lib.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: init.method || 'GET',
      headers,
      timeout: 120_000,
    }, res => {
      let text = '';
      res.setEncoding('utf-8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        let body: any = text;
        try { body = JSON.parse(text); } catch { /* not JSON — show it raw */ }
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          const message = (body && typeof body === 'object' && (body.error || body.detail)) || res.statusMessage;
          return reject(new Error(`${status} ${message}`));
        }
        resolve(body);
      });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', err => reject(new Error(`${url.origin}: ${err.message}`)));
    if (init.body) req.write(init.body);
    req.end();
  });
}

function age(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

export async function runRepoCli(positional: string[], options: Record<string, any>): Promise<void> {
  const url = options.url || process.env.LOGOS_URL || DEFAULT_URL;
  const token = options.token || process.env.LOGOS_REPO_TOKEN;
  const request = (route: string, init: { method?: string; body?: string } = {}) => call(url, route, { ...init, token });
  const sub = positional[1];
  const arg = positional[2];

  if (!sub || sub === 'help') {
    console.log(`logos repo — external repository capability

  logos repo status                     SSH endpoint, deployed commit, live branches
  logos repo branches                   every branch, and which ones are running
  logos repo up <branch>                boot an ephemeral instance
  logos repo down <branch>              stop one now
  logos repo log [branch] [--limit n]   recent commits
  logos repo key <file.pub> [--role main|branch|read]

  --url ${url}  (or LOGOS_URL)
  --token <token>  (or LOGOS_REPO_TOKEN)`);
    return;
  }

  switch (sub) {
    case 'status': {
      const status = await request('/_logos/repo/status');
      if (options.json) { console.log(JSON.stringify(status, null, 2)); return; }
      console.log(`clone     ${status.clone}`);
      console.log(`ssh       ${status.ssh.listening
        ? `port ${status.ssh.port}, ${status.ssh.keys} key(s), ${status.ssh.fingerprint}`
        : `not listening (${status.ssh.reason})`}`);
      console.log(`main      ${status.main.branch} @ ${(status.main.sha || '—').slice(0, 8)} (onPush: ${status.main.onPush})`);
      console.log(`branches  ${status.branches.enabled
        ? `ports ${status.branches.ports.join('–')}, idle ${age(status.branches.idleTTLms)}, max ${status.branches.max}`
        : 'disabled'}`);
      if (!status.branches.live?.length) { console.log('          (none running)'); return; }
      for (const live of status.branches.live) {
        console.log(`          ${live.branch} → :${live.port} ${live.status}, idle ${age(live.idleMs)}${live.error ? ` — ${live.error}` : ''}`);
      }
      return;
    }

    case 'branches': {
      const { branches } = await request('/_logos/repo/branches');
      if (options.json) { console.log(JSON.stringify(branches, null, 2)); return; }
      for (const branch of branches) {
        const mark = branch.isMain ? '*' : ' ';
        const live = branch.instance ? ` [${branch.instance.status} :${branch.instance.port}]` : '';
        console.log(`${mark} ${branch.branch.padEnd(28)} ${branch.sha.slice(0, 8)}  ${branch.subject}${live}`);
      }
      return;
    }

    case 'up': {
      if (!arg) { console.error('[cli] usage: logos repo up <branch>'); process.exit(1); }
      const result = await request(`/_logos/repo/branches/${slugify(arg)}/up`, { method: 'POST' });
      console.log(`${result.branch} → ${result.url}`);
      return;
    }

    case 'down': {
      if (!arg) { console.error('[cli] usage: logos repo down <branch>'); process.exit(1); }
      const result = await request(`/_logos/repo/branches/${slugify(arg)}/down`, { method: 'POST' });
      console.log(result.ok ? `${arg} stopped` : `${arg} was not running`);
      return;
    }

    case 'log': {
      const query = `?branch=${encodeURIComponent(arg || '')}&limit=${options.limit || 20}`;
      const { ref, commits } = await request(`/_logos/repo/log${query}`);
      console.log(`${ref}:`);
      for (const commit of commits) {
        console.log(`  ${commit.sha.slice(0, 8)}  ${commit.date.slice(0, 10)}  ${commit.author.padEnd(16)} ${commit.subject}`);
      }
      return;
    }

    case 'key': {
      if (!arg) { console.error('[cli] usage: logos repo key <file.pub> [--role main|branch|read]'); process.exit(1); }
      if (!fs.existsSync(arg)) { console.error(`[cli] no such file: ${arg}`); process.exit(1); }
      const result = await request('/_logos/repo/keys', {
        method: 'POST',
        body: JSON.stringify({ key: fs.readFileSync(arg, 'utf-8').trim(), role: options.role || 'main' }),
      });
      console.log(`authorized ${result.type} ${result.comment || ''} as "${result.role}"`);
      return;
    }

    default:
      console.error(`[cli] unknown "logos repo ${sub}". Run "logos repo help".`);
      process.exit(1);
  }
}

