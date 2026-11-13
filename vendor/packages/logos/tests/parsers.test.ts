// tests/parsers.test.ts — decorator parsers (routes, tools, hooks, commands,
// predicates, middleware, modules). Docs are passed as plain strings, so the
// transpiler-strips-comments problem never applies here.

import { describe, it, expect } from 'vitest';
import {
  parseRoute, parseTool, parseHook, parseCommand,
  parsePredicate, parseMiddleware, parseModule,
} from '../src/kernel/parsers';

const fn = function handler() {};

describe('parseRoute', () => {
  it('accepts the new registration forms without changing legacy root routes', () => {
    expect(parseRoute(fn, '@register router abc')?.path).toBe('abc');
    expect(parseRoute(fn, '@register router /abc')?.path).toBe('abc');
    expect(parseRoute(fn, '@register router\n * @name abc')?.path).toBe('abc');
    expect(parseRoute(fn, '@register_router /abc')?.path).toBe('/abc');
    expect(() => parseRoute(fn, '@register router\n * @method GET')).toThrow(/requires a name/);
  });

  it('accepts hooks in the new form and preserves legacy hooks', () => {
    expect(parseHook(fn, '@register hook event:changed')?.event).toBe('event:changed');
    expect(parseHook(fn, '@register hook\n * @name event:changed')?.event).toBe('event:changed');
    expect(parseHook(fn, '@register_hook event:changed')?.event).toBe('event:changed');
  });
  it('returns null without the decorator or without a function', () => {
    expect(parseRoute(fn, '@description nope')).toBeNull();
    expect(parseRoute(null as any, '@register_router x')).toBeNull();
  });

  it('defaults method to get and captures the path', () => {
    expect(parseRoute(fn, '@register_router ping')).toMatchObject({ path: 'ping', method: 'get' });
  });

  it('reads method, credential and the streaming flags', () => {
    const r = parseRoute(fn, '@register_router p\n@method POST\n@requireCredential\n@streaming');
    expect(r).toMatchObject({ method: 'post', credentialRequired: true, streaming: true });
  });

  it('keeps @auth as a temporary source compatibility alias', () => {
    expect(parseRoute(fn, '@register_router p\n@auth')).toMatchObject({ credentialRequired: true });
  });

  it('reads WebSocket stream metadata', () => {
    const r = parseRoute(fn, '@register_router chat\n@stream\n@direction inbound\n@channel room');
    expect(r).toMatchObject({ stream: true, direction: 'inbound', channel: 'room' });
  });

  it('parses @upload with defaults and with explicit args', () => {
    expect(parseRoute(fn, '@register_router up\n@upload file')!.upload)
      .toEqual({ field: 'file', quantity: 1, size: '10mb', storage: 'disk' });
    expect(parseRoute(fn, '@register_router up\n@upload photos 5 20mb memory')!.upload)
      .toEqual({ field: 'photos', quantity: 5, size: '20mb', storage: 'memory' });
  });

  it('carries conditions', () => {
    expect(parseRoute(fn, '@register_router p\n@only admin')!.condition).toEqual({ only: ['admin'] });
  });

  it('keeps routes private unless @public is explicitly enabled', () => {
    expect(parseRoute(fn, '@register_router private')!).toMatchObject({ public: false });
    expect(parseRoute(fn, '@register_router open\n@public')!).toMatchObject({ public: true });
    expect(parseRoute(fn, '@register_router closed\n@public false')!).toMatchObject({ public: false });
    expect(parseRoute(fn, '@register_router open\n@public true')!).toMatchObject({ public: true });
  });

  it('rejects an invalid @public value instead of opening a route by accident', () => {
    expect(() => parseRoute(fn, '@register_router p\n@public perhaps')).toThrow(/@public/);
  });
});

describe('parseTool', () => {
  it('uses the decorator name, then fn.name, then a fallback', () => {
    expect(parseTool(function add() {}, '@register_tool sum')!.name).toBe('sum');
    expect(parseTool(function add() {}, '@register_tool')!.name).toBe('add');
    expect(parseTool(() => {}, '@register_tool')!.name).toBe('anonymousTool');
  });

  it('reads description and required/optional params', () => {
    const t = parseTool(fn, '@register_tool t\n@description adds\n@param {number} a - first\n@param {number?} b - second');
    expect(t!.description).toBe('adds');
    const a = t!.parameters.find((p: any) => p.name === 'a');
    const b = t!.parameters.find((p: any) => p.name === 'b');
    expect(a).toMatchObject({ type: 'number', required: true });
    expect(b).toMatchObject({ type: 'number', required: false });
  });

  it('expands nested (dot) params into an object parent', () => {
    const t = parseTool(fn, '@register_tool t\n@param {string} user.name - the name');
    const parent = t!.parameters.find((p: any) => p.name === 'user');
    expect(parent).toMatchObject({ name: 'user', type: 'object' });
  });

  it('reads an inline @enum into the param', () => {
    const t = parseTool(fn, '@register_tool t\n@param {string?} status - the state @enum draft,published,archived');
    const p: any = t!.parameters.find((x: any) => x.name === 'status');
    expect(p).toMatchObject({ type: 'string', required: false, description: 'the state' });
    expect(p.enum).toEqual(['draft', 'published', 'archived']);
  });

  it('reads a literal union in the type as an enum', () => {
    const t = parseTool(fn, '@register_tool t\n@param {(\'draft\'|"published")?} status - the state');
    const p: any = t!.parameters.find((x: any) => x.name === 'status');
    expect(p).toMatchObject({ type: 'string', required: false, description: 'the state' });
    expect(p.enum).toEqual(['draft', 'published']);
  });

  it('reads @enumSource as a dynamic source and keeps it out of the description', () => {
    const t = parseTool(fn, '@register_tool t\n@param {string} channel - target @enumSource tool:ntfy/listNtfyChannels#name');
    const p: any = t!.parameters.find((x: any) => x.name === 'channel');
    expect(p).toMatchObject({ description: 'target', enumSource: 'tool:ntfy/listNtfyChannels#name' });
    expect(p.enum).toBeUndefined();
  });

  it('leaves plain params untouched', () => {
    const t = parseTool(fn, '@register_tool t\n@param {string} q - the query');
    expect(t!.parameters.find((x: any) => x.name === 'q'))
      .toEqual({ name: 'q', type: 'string', description: 'the query', required: true });
  });

  it('defaults reach to auto and reads an explicit @reach', () => {
    expect(parseTool(fn, '@register_tool t')!.reach).toBe('auto');
    expect(parseTool(fn, '@register_tool t\n@reach always')!.reach).toBe('always');
    expect(parseTool(fn, '@register_tool t\n@reach manual')!.reach).toBe('manual');
    expect(parseTool(fn, '@register_tool t\n@reach bogus')!.reach).toBe('auto');
  });

  it('reads declarative recovery and reconciliation metadata', () => {
    const declared = parseTool(fn, '@register_tool charge\n@recovery reconcile\n@reconcile getCharge');
    expect(declared!.recoveryPolicy).toBe('reconcile');
    expect(declared!.reconcileTool).toBe('getCharge');
    expect(parseTool(fn, '@register_tool read\n@recovery read-only')!.recoveryPolicy).toBe('read-only');
    expect(parseTool(fn, '@register_tool legacy\n@recovery bogus')!.recoveryPolicy).toBeNull();
  });

  it('returns null without the decorator', () => {
    expect(parseTool(fn, '@description only')).toBeNull();
  });
});

describe('parseHook', () => {
  it('captures the event and defaults priority to 100', () => {
    expect(parseHook(fn, '@register_hook user:created')).toMatchObject({ event: 'user:created', priority: 100 });
  });

  it('reads an explicit @priority and conditions', () => {
    const h = parseHook(fn, '@register_hook e\n@priority 5\n@never disabled');
    expect(h).toMatchObject({ event: 'e', priority: 5 });
    expect(h!.condition).toEqual({ never: ['disabled'] });
  });

  it('returns null without the decorator', () => {
    expect(parseHook(fn, 'nope')).toBeNull();
  });
});

describe('parseCommand', () => {
  it('reads name, description and params', () => {
    const c = parseCommand(function greet() {}, '@register_command hi\n@description says hi\n@param {string} who - target');
    expect(c).toMatchObject({ name: 'hi', description: 'says hi' });
    expect(c!.parameters[0]).toMatchObject({ name: 'who', required: true });
  });

  it('falls back to fn.name then a default', () => {
    expect(parseCommand(function greet() {}, '@register_command')!.name).toBe('greet');
    expect(parseCommand(() => {}, '@register_command')!.name).toBe('anonymousCommand');
  });

  it('defaults to minimal CLI execution and accepts an explicit full-runtime opt-in', () => {
    expect(parseCommand(fn, '@register_command quick')!.cliRuntime).toBe('minimal');
    expect(parseCommand(fn, '@register_command legacy\n@cli_runtime full')!.cliRuntime).toBe('full');
  });
});

describe('parsePredicate', () => {
  it('reads an explicit name or falls back to fn.name', () => {
    expect(parsePredicate(fn, '@register_predicate isAdmin')!.name).toBe('isAdmin');
    expect(parsePredicate(function isOwner() {}, '@register_predicate')!.name).toBe('isOwner');
  });

  it('returns null without the decorator or a resolvable name', () => {
    expect(parsePredicate(fn, 'nope')).toBeNull();
    expect(parsePredicate(() => {}, '@register_predicate')).toBeNull();
  });
});

describe('parseMiddleware', () => {
  it('reads the name and every @predicate', () => {
    const m = parseMiddleware(fn, '@register_middleware audit\n@predicate isAdmin\n@predicate isOwner');
    expect(m).toMatchObject({ name: 'audit' });
    expect(m!.predicates).toEqual(['isAdmin', 'isOwner']);
  });

  it('returns null without the decorator', () => {
    expect(parseMiddleware(fn, '@predicate isAdmin')).toBeNull();
  });
});

describe('parseModule', () => {
  it('defaults phase=wire, swappable=true, runtime=node', () => {
    expect(parseModule(fn, '@register_module cache'))
      .toMatchObject({ name: 'cache', phase: 'wire', swappable: true, runtime: 'node' });
  });

  it('reads phase, after, swappable false, runtime and events', () => {
    const m = parseModule(fn, '@register_module http\n@phase boot\n@after env\n@after db\n@swappable false\n@runtime bun\n@events reload:*');
    expect(m).toMatchObject({ name: 'http', phase: 'boot', swappable: false, runtime: 'bun' });
    expect(m!.after).toEqual(['env', 'db']);
    expect(m!.events).toEqual(['reload:*']);
  });

  it('returns null without the decorator', () => {
    expect(parseModule(fn, '@phase boot')).toBeNull();
  });
});
