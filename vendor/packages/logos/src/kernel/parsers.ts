// kernel/parsers.ts — all decorator parsers in one place.
//
// Every parser receives the function AND the resolved doc block (which may
// come from above the declaration or inside the body — see jsdoc.ts). A parser
// returns metadata or null when the doc doesn't carry its decorator.
//
// Transitional ThinkIac decorators. Their public reference lives with the
// host, not in Lógos; this parser remains a compatibility seam during extraction.
//   @register_router <path>      HTTP route          (+ @method @requireCredential @upload @streaming @stream @direction @channel @offline)
//   @register_tool [name]        LLM tool            (+ @description @param [@enum|@enumSource] @only/@never/@when @reach)
//   @register_hook <event>       event handler       (+ @priority @only/@never/@when)
//   @register_command [name]     CLI command         (+ @description @param @only/@never/@when @cli_runtime)
//   @register_predicate [name]   middleware predicate
//   @register_middleware <name>  package middleware  (+ @predicate)
//   @register_module <name>      system module       (+ @phase @after @swappable @runtime @events)

'use strict';

import { docLines, tagValues, hasTag, parseConditions, parseReach } from './jsdoc';

// O tipo aceita a forma simples ({string}, {string[]}, {number?}) e a união de
// literais ({('draft'|'published')?}) — açúcar para declarar um enum no próprio tipo.
const PARAM_RE = /@param {([^}]+)} (\S+) - (.+)/;
// União de literais entre parênteses: ('a'|'b') ou ("a"|"b").
const UNION_RE = /^\((.+)\)$/;
// Tags inline na mesma linha do @param (a descrição termina onde elas começam).
const ENUM_RE = /@enum\s+(\S+)/;
const ENUM_SOURCE_RE = /@enumSource\s+(\S+)/;

function parseUnion(type: string): string[] | null {
  const match = type.match(UNION_RE);
  if (!match) return null;
  const values = match[1]
    .split('|')
    .map(v => v.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  return values.length ? values : null;
}

function parseParams(lines: string[]) {
  const parameters: any[] = [];
  const paramMap: Record<string, any> = {};

  for (const line of lines) {
    if (!line.startsWith('@param')) continue;
    const match = line.match(PARAM_RE);
    if (!match) continue;

    let [, type, name, description] = match;
    const required = !type.endsWith('?');
    if (!required) type = type.slice(0, -1);

    // @enum / @enumSource vivem no fim da linha; saem da descrição.
    const enumMatch = description.match(ENUM_RE);
    const sourceMatch = description.match(ENUM_SOURCE_RE);
    description = description.replace(ENUM_SOURCE_RE, '').replace(ENUM_RE, '').trim();

    const unionValues = parseUnion(type);
    if (unionValues) type = 'string';

    const values = enumMatch
      ? enumMatch[1].split(',').map(v => v.trim()).filter(Boolean)
      : unionValues;
    const enumSource = sourceMatch ? sourceMatch[1] : null;

    const cleanName = name.replace(/\[\]/g, '');
    const isArray = name.includes('[]');
    const isNested = cleanName.includes('.');

    if (isNested) {
      const parentName = cleanName.split('.')[0];
      if (!paramMap[parentName]) {
        const parent = {
          name: parentName,
          type: isArray ? 'array' : 'object',
          description: `${parentName} object`,
          required,
        };
        parameters.push(parent);
        paramMap[parentName] = parent;
      } else if (required) {
        paramMap[parentName].required = true;
      }
    }

    const param: any = { name, type, description, required };
    if (values && values.length) param.enum = values;
    if (enumSource) param.enumSource = enumSource;
    parameters.push(param);
    paramMap[name] = param;
  }

  return parameters;
}

function description(lines: string[]): string | null {
  const line = lines.find(l => l.startsWith('@description'));
  return line ? line.replace('@description', '').trim() : null;
}

// ── @offline ────────────────────────────────────────────────────────────────
//
// Política de rede da rota, lida pelo Service Worker através de
// GET /_logos/offline (o SW não lê JSDoc).
//
//   cache  — GET servido do cache e revalidado em segundo plano
//   online — exige rede; falha explícita. É o default, e é o que o silêncio
//            de uma rota sem anotação significa.
//
// A flag é declarada e nunca inferida do método HTTP: um GET pode ser um
// relatório que não faz sentido velho e um POST pode ser um pagamento que não
// pode rodar duas vezes. Declarar é chato uma vez; adivinhar é errado sempre.

export type RouteOfflinePolicy = 'cache' | 'online';

export const OFFLINE_POLICIES: RouteOfflinePolicy[] = ['cache', 'online'];

/**
 * `queue` (fila de escrita) é recusado de propósito enquanto não existir dedupe
 * por chave de idempotência no servidor: sem isso, reenviar uma mutação depois
 * de uma oscilação de rede cria registro duplicado — exatamente o defeito que a
 * fila deveria evitar. Recusar no carregamento é melhor que aceitar e ignorar,
 * porque um pacote que escreveu `queue` acreditaria que a escrita está
 * protegida quando não está.
 */
export function parseOffline(doc: string, method = 'get'): RouteOfflinePolicy {
  const match = doc.match(/@offline\s+(\S+)/);
  if (!match) return 'online';

  const value = match[1].trim().toLowerCase();

  if (value === 'queue') {
    throw new Error(
      '[logos] @offline queue ainda não existe: fila de escrita exige dedupe por chave ' +
      'de idempotência no servidor, senão o reenvio duplica o registro. Remova a anotação ' +
      '(rotas sem @offline já são "online") até a fila existir.'
    );
  }
  if (OFFLINE_POLICIES.indexOf(value as RouteOfflinePolicy) === -1) {
    throw new Error(
      `[logos] @offline "${value}" desconhecido — use ${OFFLINE_POLICIES.join(' ou ')}. ` +
      'Valor inválido é erro de carregamento, e não "online" silencioso, para que a política ' +
      'nunca prometa menos do que o autor escreveu.'
    );
  }
  if (value === 'cache' && method !== 'get') {
    throw new Error(
      `[logos] @offline cache só vale para GET (esta rota é ${method.toUpperCase()}). ` +
      'Servir uma mutação do cache devolveria uma resposta antiga para uma escrita que nunca aconteceu.'
    );
  }
  return value as RouteOfflinePolicy;
}

// ── Routes ──────────────────────────────────────────────────────────────────

function registration(doc: string, kind: 'router' | 'hook'): { value: string; legacy: boolean } | null {
  const lines = docLines(doc);
  const legacy = lines.map(line => line.match(new RegExp(`^@register_${kind}[ \\t]+([^\\s@]+)`))).find(Boolean);
  if (legacy) return { value: legacy[1], legacy: true };
  const modern = lines.map(line => line.match(new RegExp(`^@register[ \\t]+${kind}(?:[ \\t]+([^\\s@]+))?(?:[ \\t]|$)`))).find(Boolean);
  if (!modern) return null;
  const name = modern[1] || lines.map(line => line.match(/^@name[ \t]+([^\s@]+)/)).find(Boolean)?.[1];
  if (!name) throw new Error(`[logos] @register ${kind} requires a name`);
  return { value: name, legacy: false };
}

export function parseRoute(fn: Function, doc: string | null) {
  if (typeof fn !== 'function' || !doc) return null;
  const routeMatch = registration(doc, 'router');
  if (!routeMatch) return null;

  const methodMatch = doc.match(/@method\s+([^\s]+)/);
  const directionMatch = doc.match(/@direction\s+(\S+)/);
  const channelMatch = doc.match(/@channel\s+(\S+)/);

  const uploadMatch = doc.match(/@upload\s+(\S+)(?:\s+(\d+))?(?:\s+(\d+(?:kb|mb|gb)))?(?:\s+(memory|disk))?/i);
  let upload: any = null;
  if (uploadMatch) {
    upload = {
      field: uploadMatch[1],
      quantity: uploadMatch[2] ? Number(uploadMatch[2]) : 1,
      size: uploadMatch[3] || '10mb',
      storage: uploadMatch[4] || 'disk',
    };
  }

  const method = methodMatch ? methodMatch[1].trim().toLowerCase() : 'get';
  const publicMatch = doc.match(/@public(?:\s+(\S+))?/);
  let isPublic = false;
  if (publicMatch) {
    const value = (publicMatch[1] || 'true').toLowerCase();
    if (value !== 'true' && value !== 'false') {
      throw new Error(`[logos] @public \"${value}\" inválido — use true, false, ou omita o valor.`);
    }
    isPublic = value === 'true';
  }

  return {
    path: routeMatch.legacy ? routeMatch.value : routeMatch.value.replace(/^\/+/, ''),
    method,
    // Browser-session access is private by default. @public (or @public true)
    // is the sole opt-in; @public false documents an intentional override.
    public: isPublic,
    handler: fn,
    upload,
    // @offline — política de rede da rota (default 'online'; ver parseOffline)
    offline: parseOffline(doc, method),
    // @streaming — handler writes the response itself (SSE, chunked, files)
    streaming: /@streaming\b/.test(doc),
    // @stream — WebSocket handler (bidirectional channel)
    stream: /@stream\b/.test(doc),
    direction: directionMatch ? directionMatch[1].trim() : 'bidirectional',
    channel: channelMatch ? channelMatch[1].trim() : null,
    // @requireCredential is neutral. @auth is accepted only as a source
    // compatibility alias while packages migrate their decorators.
    credentialRequired: hasTag(doc, 'requireCredential') || hasTag(doc, 'auth'),
    condition: parseConditions(doc),
  };
}

// ── Tools ───────────────────────────────────────────────────────────────────

export function parseTool(fn: Function, doc: string | null) {
  if (typeof fn !== 'function' || !doc) return null;
  const lines = docLines(doc);
  const registerLine = lines.find(l => l.startsWith('@register_tool'));
  if (!registerLine) return null;

  const registerMatch = registerLine.match(/@register_tool\s*(\S+)?/);
  const name = (registerMatch && registerMatch[1]) || fn.name || 'anonymousTool';
  const recoveryRaw = (tagValues(doc, 'recovery')[0] || '').toLowerCase();
  const recoveryPolicy = ['none', 'read-only', 'idempotent', 'reconcile'].includes(recoveryRaw)
    ? recoveryRaw
    : null;
  const reconcileTool = tagValues(doc, 'reconcile')[0] || null;

  return {
    name,
    description: description(lines),
    parameters: parseParams(lines),
    call: fn,
    condition: parseConditions(doc),
    reach: parseReach(doc),
    recoveryPolicy,
    reconcileTool,
  };
}

// ── Hooks ───────────────────────────────────────────────────────────────────

export function parseHook(fn: Function, doc: string | null) {
  if (typeof fn !== 'function' || !doc) return null;
  const hookMatch = registration(doc, 'hook');
  if (!hookMatch) return null;

  const priorityMatch = doc.match(/@priority\s+(\d+)/);

  return {
    event: hookMatch.value,
    call: fn,
    priority: priorityMatch ? parseInt(priorityMatch[1], 10) : 100,
    condition: parseConditions(doc),
  };
}

// ── Commands ────────────────────────────────────────────────────────────────

export function parseCommand(fn: Function, doc: string | null) {
  if (typeof fn !== 'function' || !doc) return null;
  const lines = docLines(doc);
  const registerLine = lines.find(l => l.startsWith('@register_command'));
  if (!registerLine) return null;

  const registerMatch = registerLine.match(/@register_command\s*(\S+)?/);
  const cliRuntimeMatch = lines.find(l => l.startsWith('@cli_runtime'))?.match(/^@cli_runtime\s+(minimal|full)$/);

  return {
    name: (registerMatch && registerMatch[1]) || fn.name || 'anonymousCommand',
    description: description(lines),
    parameters: parseParams(lines),
    call: fn,
    condition: parseConditions(doc),
    // Commands are isolated by default. `full` is an explicit escape hatch
    // for legacy handlers that rely on the booted runtime/container.
    cliRuntime: cliRuntimeMatch?.[1] ?? 'minimal',
  };
}

// ── Predicates ──────────────────────────────────────────────────────────────

export function parsePredicate(fn: Function, doc: string | null) {
  if (typeof fn !== 'function' || !doc) return null;
  const match = doc.match(/@register_predicate\s*(\w+)?/);
  if (!match) return null;
  const name = match[1] || fn.name || null;
  if (!name) return null;
  return { name, call: fn };
}

// ── Middleware ──────────────────────────────────────────────────────────────

export function parseMiddleware(fn: Function, doc: string | null) {
  if (typeof fn !== 'function' || !doc) return null;
  const registerMatch = doc.match(/@register_middleware\s+(\w+)/);
  if (!registerMatch) return null;

  return {
    name: registerMatch[1],
    call: fn,
    predicates: [...doc.matchAll(/@predicate\s+(\w+)/g)].map(m => m[1]),
  };
}

// ── Modules (new in v2) ─────────────────────────────────────────────────────
//
// A module is an install(container) function. Workspace modules override
// built-ins by name. @swappable false means "replace only on next boot"
// (for modules that hold process resources: DB handles, ports, workers).

export function parseModule(fn: Function, doc: string | null) {
  if (typeof fn !== 'function' || !doc) return null;
  const match = doc.match(/@register_module\s+([^\s]+)/);
  if (!match) return null;

  const phaseMatch = doc.match(/@phase\s+(boot|wire)/);
  const runtimeMatch = doc.match(/@runtime\s+(\S+)/);

  return {
    name: match[1].trim(),
    phase: phaseMatch ? phaseMatch[1] : 'wire',
    after: tagValues(doc, 'after'),
    swappable: !/@swappable\s+false/.test(doc),
    runtime: runtimeMatch ? runtimeMatch[1].trim() : 'node',
    events: tagValues(doc, 'events'),
    install: fn,
  };
}
