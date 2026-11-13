'use strict';

// Deliberately dependency-free: it runs from both src in tests and dist in a
// published runtime. The only ambient Lógos API exposed to package code is the
// mediated event facade below.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const pkgDir = path.resolve(process.env.LOGOS_ISOLATED_PACKAGE);
const hostProcess = process;
const functions = new Map();
const pending = new Map();
let sequence = 0;
hostProcess.on('disconnect', () => hostProcess.exit(1));

function request(op, payload) {
  const id = String(++sequence);
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); hostProcess.send({ op, id, ...payload }); });
}
function requestEvent(event, payload) { return request('event', { event, payload }); }

function databaseProxy(tenant) {
  return new Proxy({}, { get(_target, entity) {
    if (typeof entity !== 'string') return undefined;
    return new Proxy({}, { get(_model, method) {
      if (typeof method !== 'string') return undefined;
      return (...args) => request('capability', { request: { surface: 'database', tenant, entity, method, args } });
    }});
  }});
}

const logosFacade = Object.freeze({
  emit: requestEvent,
  dispatchEvent: requestEvent,
  $: requestEvent,
  getProxy: databaseProxy,
});
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'logos') return logosFacade;
  // An isolated package receives capabilities through `logos`, never direct
  // Node authority. node:net/fetch would bypass origin grants; node:fs would
  // bypass declared file roots.
  if (Module.builtinModules.includes(request) || request.startsWith('node:')) {
    throw new Error(`Native module access is denied in isolated packages: ${request}`);
  }
  const resolved = Module._resolveFilename(request, parent, isMain);
  const real = fs.realpathSync(resolved);
  if (real !== pkgDir && !real.startsWith(`${pkgDir}${path.sep}`)) {
    throw new Error(`Module escapes isolated package root: ${request}`);
  }
  if (path.extname(real) === '.node') throw new Error(`Native addons are denied in isolated packages: ${request}`);
  return originalLoad.call(this, request, parent, isMain);
};

// The bootstrap retains hostProcess for IPC/lifecycle; package modules only
// receive a harmless immutable environment marker and must use IPC facades.
Object.defineProperty(globalThis, 'process', {
  value: Object.freeze({ env: Object.freeze({ NODE_ENV: hostProcess.env.NODE_ENV ?? 'production' }) }),
  configurable: false,
  enumerable: false,
  writable: false,
});
Object.defineProperty(globalThis, 'fetch', { value: undefined, configurable: false, writable: false });

function files(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files(file, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(file);
  }
  return out;
}
function docOf(fn, source) {
  const text = Function.prototype.toString.call(fn); const inside = text.match(/\/\*\*([\s\S]*?)\*\//);
  if (inside) return inside[0];
  const name = fn.name.replace(/^bound /, '');
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const above = source.match(new RegExp(`/\\*\\*([\\s\\S]*?)\\*/\\s*(?:async\\s+)?function\\s+${escaped}\\b`));
  return above ? above[0] : '';
}
function tag(doc, name) { const match = doc.match(new RegExp(`@${name}\\s+([^\\s@]+)`)); return match ? match[1].trim() : null; }
function params(doc) {
  const properties = {}; const required = [];
  for (const match of doc.matchAll(/@param\s+\{([^}]+)\}\s+([\w.]+)\s*(?:-\s*([^\n*]+))?/g)) {
    const optional = match[1].endsWith('?'); const type = match[1].replace('?', '').replace('[]', '');
    properties[match[2]] = { type: ['string','number','integer','boolean','object','array'].includes(type) ? type : 'string', description: match[3]?.trim() || null };
    if (!optional) required.push(match[2]);
  }
  return { type: 'object', properties, required };
}
function descriptor(kind, id, fn, doc) {
  let value = tag(doc, kind === 'tool' ? 'register_tool' : kind === 'route' ? 'register_router' : 'register_hook');
  if (!value && kind !== 'tool') {
    const type = kind === 'route' ? 'router' : 'hook';
    const lines = doc.split('\n').map(line => line.trim().replace(/^\/\*\*?\s*/, '').replace(/^\*\s?/, '').replace(/\s*\*\/$/, ''));
    const declaration = lines.map(line => line.match(new RegExp(`^@register[ \\t]+${type}(?:[ \\t]+([^\\s@]+))?(?:[ \\t]|$)`))).find(Boolean);
    if (declaration) {
      value = declaration[1] || lines.map(line => line.match(/^@name[ \t]+([^\s@]+)/)).find(Boolean)?.[1];
      if (!value) throw new Error(`[logos] @register ${type} requires a name`);
      if (kind === 'route') value = value.replace(/^\/+/, '');
    }
  }
  if (!value) return null;
  const item = { id, kind };
  if (kind === 'tool') { item.name = value; item.description = tag(doc, 'description'); item.parameters = params(doc); }
  if (kind === 'route') {
    item.path = value; item.method = (tag(doc, 'method') || 'get').toLowerCase();
    const publicMatch = doc.match(/@public(?:[ \t]+(?!(?:@|\*\/))(\S+))?/i);
    const publicValue = publicMatch?.[1]?.toLowerCase();
    if (publicMatch && publicValue && !['true', 'false'].includes(publicValue)) {
      throw new Error(`[logos] @public \"${publicValue}\" inválido — use true, false, ou omita o valor.`);
    }
    item.public = Boolean(publicMatch) && publicValue !== 'false';
  }
  if (kind === 'hook') { item.event = value; item.priority = Number(tag(doc, 'priority') || 100); }
  return item;
}
async function discover() {
  const result = { tools: [], routes: [], hooks: [], declarations: [] }; let id = 0;
  for (const file of files(pkgDir)) {
    delete require.cache[require.resolve(file)];
    const source = fs.readFileSync(file, 'utf8'); const exports = require(file);
    for (const fn of Object.values(exports)) {
      if (typeof fn !== 'function') continue;
      const doc = docOf(fn, source);
      const tags = {};
      const registrations = [];
      for (const line of doc.split('\n').map(line => line.trim().replace(/^\/\*\*?\s*/, '').replace(/^\*\s?/, '').replace(/\s*\*\/$/, ''))) {
        const match = line.match(/^@([\w-]+)(?:[ \t]+(.*?))?[ \t]*$/);
        if (!match) continue;
        const [, key, raw = ''] = match; const value = raw.trim();
        (tags[key] ||= []).push(value);
        if (key === 'register') {
          const registration = value.match(/^([^\s]+)(?:[ \t]+(.*))?$/);
          if (registration) registrations.push({ type: registration[1], name: registration[2]?.trim() || null, legacy: false });
        } else if (key.startsWith('register_') && key.length > 9) {
          registrations.push({ type: key.slice(9), name: value || null, legacy: true });
        }
      }
      for (const declaration of registrations) {
        const handlerId = `declaration:${++id}`;
        functions.set(handlerId, fn);
        result.declarations.push({ id: handlerId, file, declaration: { ...declaration, name: declaration.name ?? tags.name?.[0] ?? null, tags } });
      }
      for (const [kind, key] of [['tool','tools'], ['route','routes'], ['hook','hooks']]) {
        const handlerId = `${kind}:${++id}`; const item = descriptor(kind, handlerId, fn, doc);
        if (item) { functions.set(handlerId, fn); result[key].push(item); }
      }
    }
  }
  return result;
}
hostProcess.on('message', async message => {
  if (!message || typeof message !== 'object') return;
  if (message.op === 'event:result' || message.op === 'event:error' || message.op === 'capability:result' || message.op === 'capability:error') { const pendingCall = pending.get(String(message.id)); if (!pendingCall) return; pending.delete(String(message.id)); message.op.endsWith(':error') ? pendingCall.reject(new Error(message.error)) : pendingCall.resolve(message.result); return; }
  if (message.op === 'stop') { hostProcess.disconnect(); hostProcess.exit(0); return; }
  try {
    if (message.op === 'start') hostProcess.send({ op: 'result', id: message.id, result: await discover() });
    else if (message.op === 'invoke') { const fn = functions.get(message.handler); if (!fn) throw new Error(`Unknown isolated handler: ${message.handler}`); hostProcess.send({ op: 'result', id: message.id, result: await fn(...(message.args || []), message.context || {}) }); }
  } catch (error) { hostProcess.send({ op: 'error', id: message.id, error: error?.stack || error?.message || String(error) }); }
});
