import { docLines } from './jsdoc';

/** The JSON-compatible part of a registration. The callable travels separately. */
export interface DeclarationPayload {
  type: string;
  name: string | null;
  tags: Record<string, string[]>;
  legacy: boolean;
}

/** Parse registrations without imposing module-specific meaning on their tags. */
export function parseDeclarations(doc: string): DeclarationPayload[] {
  const tags: Record<string, string[]> = Object.create(null);
  const registrations: Array<{ type: string; name: string | null; legacy: boolean }> = [];
  for (const line of docLines(doc)) {
    const match = line.match(/^@([\w-]+)(?:[ \t]+(.*?))?[ \t]*$/);
    if (!match) continue;
    const [, tag, raw = ''] = match;
    const value = raw.trim();
    (tags[tag] ??= []).push(value);
    if (tag === 'register') {
      const registration = value.match(/^([^\s]+)(?:[ \t]+(.*))?$/);
      if (registration) registrations.push({ type: registration[1], name: registration[2]?.trim() || null, legacy: false });
    } else if (tag.startsWith('register_') && tag.length > 'register_'.length) {
      registrations.push({ type: tag.slice('register_'.length), name: value || null, legacy: true });
    }
  }
  return registrations.map(item => ({ ...item, name: item.name ?? tags.name?.[0] ?? null, tags }));
}
