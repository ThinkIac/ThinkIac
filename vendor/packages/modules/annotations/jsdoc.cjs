// kernel/jsdoc.ts — JSDoc extraction for Lógos decorators.
//
// v1 only recognised JSDoc written INSIDE the function body, because parsers
// worked on fn.toString() (which does not include comments that precede the
// declaration). v2 supports BOTH positions:
//
//   /**                       ← above (new in v2, the conventional style)
//    * @register_tool sum
//    */
//   function sum(a, b) { ... }
//
//   function sum(a, b) {
//     /**                     ← inside (v1 style, still supported)
//      * @register_tool sum
//      */
//   }
//
// "Above" docs are resolved by scanning the file source once and mapping each
// doc block to the identifier that follows it (function declarations, const
// assignments, exports.x = / module.exports.x = / export function).
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAboveDocMap = buildAboveDocMap;
exports.docInside = docInside;
exports.resolveDoc = resolveDoc;
exports.docLines = docLines;
exports.tagValues = tagValues;
exports.hasTag = hasTag;
exports.parseReach = parseReach;
exports.parseConditions = parseConditions;
const DOC_ABOVE_RE = /\/\*\*([\s\S]*?)\*\/\s*(?:export\s+(?:default\s+)?)?(?:module\.exports\.(\w+)\s*=|exports\.(\w+)\s*=|(?:async\s+)?function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=)/g;
/** Maps identifier name → doc text for every top-level "doc above declaration". */
function buildAboveDocMap(source) {
    const map = {};
    let match;
    DOC_ABOVE_RE.lastIndex = 0;
    while ((match = DOC_ABOVE_RE.exec(source)) !== null) {
        const doc = match[1];
        const name = match[2] || match[3] || match[4] || match[5];
        if (name && doc && !map[name])
            map[name] = doc;
    }
    return map;
}
/** First JSDoc block found inside fn.toString() (v1 behaviour). */
function docInside(fnSource) {
    const match = fnSource.match(/\/\*\*([\s\S]*?)\*\//);
    return match ? match[1] : null;
}
/**
 * Resolves the effective doc for a function: inside wins (v1 compat — a doc
 * physically inside the body is unambiguous), then the above-map by fn.name.
 */
function resolveDoc(fn, aboveMap) {
    const inside = docInside(fn.toString());
    if (inside)
        return inside;
    if (fn.name && aboveMap[fn.name])
        return aboveMap[fn.name];
    return null;
}
/** Splits a doc block into trimmed lines with the leading '*' removed. */
function docLines(doc) {
    return doc.split('\n').map(l => l.trim().replace(/^\*\s?/, ''));
}
/** Collects every `@tag value` occurrence in a doc block. */
function tagValues(doc, tag) {
    const re = new RegExp(`@${tag}\\s+([^\\s]+)`, 'g');
    return [...doc.matchAll(re)].map(m => m[1]);
}
/** Presence of a bare `@tag` flag. */
function hasTag(doc, tag) {
    return new RegExp(`@${tag}\\b`).test(doc);
}
const VALID_REACH = ['auto', 'always', 'manual'];
function parseReach(doc) {
    const raw = (tagValues(doc, 'reach')[0] || '').toLowerCase();
    return VALID_REACH.includes(raw) ? raw : 'auto';
}
/** Parses @only / @never / @when into a condition object (only ≡ when). */
function parseConditions(doc) {
    const condition = {};
    const only = [...tagValues(doc, 'only'), ...tagValues(doc, 'when')];
    const never = tagValues(doc, 'never');
    if (only.length)
        condition.only = only;
    if (never.length)
        condition.never = never;
    return condition;
}
