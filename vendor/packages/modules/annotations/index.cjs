'use strict';
const { parseTool, parseHook, parseRoute, parseCommand, parsePredicate, parseMiddleware } = require('./parsers.cjs');
const scanners = new WeakMap();
function createScanners(registerGeneric) {
  if (scanners.has(registerGeneric)) return scanners.get(registerGeneric);
  const exports = {};
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerTools = registerTools;
exports.registerCommands = registerCommands;
exports.registerHooks = registerHooks;
exports.registerRoutes = registerRoutes;
exports.registerPredicates = registerPredicates;
exports.registerMiddlewares = registerMiddlewares;
const JSON_SCHEMA_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);
// @param {string[]} / {object[]} etc. chegam do parser com o "type" literal
// (ex.: "string[]") — não é um tipo de JSON Schema válido, e a Anthropic API
// rejeita a tool inteira (400 "JSON schema is invalid") quando algum
// inputSchema traz isso. Convertido pra {type:'array', items:{type:...}}.
//
// @enum vira `enum` no próprio schema (JSON Schema padrão — o LLM e a UI já
// entendem). @enumSource não tem equivalente padrão: o schema é estático e a
// fonte é viva, então viaja como metadado `x-enumSource` e quem resolve é o
// consumidor (o Lógos declara, o app resolve).
function toJsonSchemaProperty(param) {
    const { type: rawType, description } = param;
    const extra = {};
    if (param.enum && param.enum.length)
        extra.enum = param.enum;
    if (param.enumSource)
        extra['x-enumSource'] = param.enumSource;
    if (typeof rawType === 'string' && rawType.endsWith('[]')) {
        const itemType = rawType.slice(0, -2);
        return {
            type: 'array',
            items: { type: JSON_SCHEMA_TYPES.has(itemType) ? itemType : 'string', ...extra },
            description,
        };
    }
    return { type: JSON_SCHEMA_TYPES.has(rawType) ? rawType : 'string', description, ...extra };
}
function registerTools(agentFolder) {
    return registerGeneric(agentFolder, parseTool, 'tools', meta => ({
        name: meta.name,
        description: meta.description,
        parameters: {
            type: 'object',
            properties: (meta.parameters || []).reduce((acc, p) => {
                acc[p.name] = toJsonSchemaProperty(p);
                return acc;
            }, {}),
            required: (meta.parameters || []).filter((p) => p.required).map((p) => p.name),
        },
        call: meta.call,
        condition: meta.condition,
        _file: meta._file,
    }));
}
function registerCommands(agentFolder) {
    return registerGeneric(agentFolder, parseCommand, 'commands');
}
function registerHooks(agentFolder) { return registerGeneric(agentFolder, parseHook, 'hooks'); }
function registerRoutes(agentFolder) { return registerGeneric(agentFolder, parseRoute, 'routes'); }
function registerPredicates(agentFolder) { return registerGeneric(agentFolder, parsePredicate, 'predicates'); }
function registerMiddlewares(agentFolder) { return registerGeneric(agentFolder, parseMiddleware, 'middlewares'); }

  scanners.set(registerGeneric, exports);
  return exports;
}
module.exports = { createScanners };
