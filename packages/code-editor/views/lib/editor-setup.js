// CodeMirror 6 wiring for the code editor.
//
// This module is browser-only and is loaded with a dynamic import() from
// Editor.svelte's onMount. That is deliberate: the view engine renders every
// component on the server first, and keeping CodeMirror out of the SSR graph
// means no DOM-shaped import ever has to run in Node.
//
// It replaces views/lib/highlight.js, whose textarea + innerHTML approach
// re-tokenized and re-serialized the entire file on every keystroke.

import { EditorState, Compartment, EditorSelection } from '@codemirror/state';
import {
    EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
    drawSelection, dropCursor, rectangularSelection, crosshairCursor,
    highlightSpecialChars,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import {
    syntaxHighlighting, HighlightStyle, indentUnit, bracketMatching,
    foldGutter, foldKeymap, indentOnInput, StreamLanguage,
} from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { extOf } from './lang-label.js';

import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { properties } from '@codemirror/legacy-modes/mode/properties';

// ── Language selection ──────────────────────────────────────────────────────
// Keyed by extension, like the old LANG_BY_EXT, but each entry now yields a
// real grammar instead of a hand-rolled dialect flag.
const LANGUAGES = {
    js: () => javascript(), mjs: () => javascript(), cjs: () => javascript(),
    jsx: () => javascript({ jsx: true }),
    ts: () => javascript({ typescript: true }),
    tsx: () => javascript({ typescript: true, jsx: true }),
    // Svelte is HTML with embedded <script>/<style>; lang-html handles both.
    svelte: () => html(), html: () => html(), htm: () => html(),
    json: () => json(),
    css: () => css(), scss: () => css(),
    md: () => markdown(), markdown: () => markdown(),
    py: () => python(),
    sql: () => sql(),
    yaml: () => yaml(), yml: () => yaml(),
    sh: () => StreamLanguage.define(shell), bash: () => StreamLanguage.define(shell),
    toml: () => StreamLanguage.define(toml),
    ini: () => StreamLanguage.define(properties),
};

export { extOf, langLabel } from './lang-label.js';

function languageFor(filePath) {
    const factory = LANGUAGES[extOf(filePath)];
    // No grammar (plain text, Dockerfile, .prisma…) is a valid state: the
    // editor still gets undo, search, folding and line numbers.
    return factory ? factory() : [];
}

// ── Theme ───────────────────────────────────────────────────────────────────
// The colours mirror the --tk-* tokens declared on .vsc in Index.svelte, so the
// editor surface matches the chrome around it in both themes.
const PALETTE = {
    dark: {
        bg: '#111111', text: '#f5f5f5', caret: '#f5f5f5', gutter: '#888888',
        activeLine: 'rgba(255,255,255,.035)', selection: 'rgba(38,79,120,.7)',
        matchingBracket: 'rgba(255,255,255,.18)', panel: '#181818', border: 'rgba(255,255,255,.09)',
        comment: '#6a9955', string: '#ce9178', number: '#b5cea8', keyword: '#569cd6',
        name: '#9cdcfe', func: '#dcdcaa', type: '#4ec9b0', op: '#d4d4d4', invalid: '#f87171',
    },
    light: {
        bg: '#ffffff', text: '#1a1a1a', caret: '#111111', gutter: '#666666',
        activeLine: 'rgba(0,0,0,.035)', selection: 'rgba(51,122,183,.25)',
        matchingBracket: 'rgba(0,0,0,.15)', panel: '#f5f5f5', border: 'rgba(0,0,0,.10)',
        comment: '#227722', string: '#a31515', number: '#098658', keyword: '#0000ff',
        name: '#0b7285', func: '#795e26', type: '#267f99', op: '#383838', invalid: '#c53030',
    },
};

function themeExtension(mode, fontSize) {
    const c = PALETTE[mode === 'light' ? 'light' : 'dark'];
    const mono = "'Ubuntu Mono', 'Consolas', 'Menlo', 'Monaco', monospace";
    const view = EditorView.theme({
        '&': { color: c.text, backgroundColor: c.bg, height: '100%', fontSize: `${fontSize}px` },
        '.cm-content': { fontFamily: mono, padding: '12px 0', caretColor: c.caret },
        '.cm-scroller': { fontFamily: mono, lineHeight: '1.6', overflow: 'auto' },
        '.cm-gutters': { backgroundColor: c.bg, color: c.gutter, border: 'none', borderRight: `1px solid ${c.border}` },
        '.cm-activeLineGutter': { backgroundColor: c.activeLine, color: c.text },
        '.cm-activeLine': { backgroundColor: c.activeLine },
        '.cm-cursor, .cm-dropCursor': { borderLeftColor: c.caret },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
            { backgroundColor: c.selection },
        '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: c.matchingBracket, outline: 'none' },
        '.cm-selectionMatch': { backgroundColor: c.matchingBracket },
        '.cm-panels': { backgroundColor: c.panel, color: c.text, borderColor: c.border },
        '.cm-panels input, .cm-panels button': {
            backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}`,
            borderRadius: '3px', padding: '2px 6px', font: "12px 'Ubuntu', system-ui, sans-serif",
        },
        '.cm-searchMatch': { backgroundColor: 'rgba(255,214,0,.28)' },
        '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(255,214,0,.5)' },
        '.cm-tooltip': { backgroundColor: c.panel, border: `1px solid ${c.border}`, color: c.text },
        '.cm-foldPlaceholder': { backgroundColor: c.panel, border: `1px solid ${c.border}`, color: c.gutter },
    }, { dark: mode !== 'light' });

    const highlight = HighlightStyle.define([
        { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: c.comment, fontStyle: 'italic' },
        { tag: [t.string, t.special(t.string), t.regexp], color: c.string },
        { tag: [t.number, t.bool, t.null, t.integer, t.float], color: c.number },
        { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword, t.self], color: c.keyword },
        { tag: [t.definitionKeyword, t.moduleKeyword], color: c.keyword },
        { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: c.func },
        { tag: [t.typeName, t.className, t.namespace, t.tagName], color: c.type },
        { tag: [t.propertyName, t.attributeName, t.variableName, t.labelName], color: c.name },
        { tag: [t.operator, t.punctuation, t.separator, t.bracket, t.derefOperator], color: c.op },
        { tag: [t.invalid], color: c.invalid },
        { tag: [t.heading], color: c.keyword, fontWeight: 'bold' },
        { tag: [t.link, t.url], color: c.name, textDecoration: 'underline' },
        { tag: [t.emphasis], fontStyle: 'italic' },
        { tag: [t.strong], fontWeight: 'bold' },
    ], { all: { color: c.text } });

    return [view, syntaxHighlighting(highlight)];
}

// ── Editor construction ─────────────────────────────────────────────────────
// Compartments are per-editor, not module-level: two editors sharing one
// Compartment instance would reconfigure each other.
const CONF = new WeakMap();

function confOf(view) {
    const conf = CONF.get(view);
    if (!conf) throw new Error('editor was not created by createEditor()');
    return conf;
}

export function createEditor({ parent, doc = '', path = '', theme = 'dark', fontSize = 13, readOnly = false, onChange, onSave }) {
    const languageConf = new Compartment();
    const themeConf = new Compartment();
    const readOnlyConf = new Compartment();
    const state = EditorState.create({
        doc,
        extensions: [
            lineNumbers(),
            highlightActiveLineGutter(),
            highlightSpecialChars(),
            history(),
            foldGutter(),
            drawSelection(),
            dropCursor(),
            EditorState.allowMultipleSelections.of(true),
            indentOnInput(),
            bracketMatching(),
            closeBrackets(),
            autocompletion(),
            rectangularSelection(),
            crosshairCursor(),
            highlightActiveLine(),
            highlightSelectionMatches(),
            search({ top: true }),
            indentUnit.of('    '),
            EditorView.lineWrapping,
            keymap.of([
                // Ctrl/Cmd+S has to come first, otherwise the browser's own
                // "save page" wins.
                { key: 'Mod-s', preventDefault: true, run: () => { onSave?.(); return true; } },
                ...closeBracketsKeymap,
                ...defaultKeymap,
                ...searchKeymap,
                ...historyKeymap,
                ...foldKeymap,
                ...completionKeymap,
                indentWithTab,
            ]),
            languageConf.of(languageFor(path)),
            themeConf.of(themeExtension(theme, fontSize)),
            readOnlyConf.of(EditorState.readOnly.of(readOnly)),
            EditorView.updateListener.of((update) => {
                if (update.docChanged) onChange?.(update.state.doc.toString());
            }),
        ],
    });
    const view = new EditorView({ state, parent });
    CONF.set(view, { languageConf, themeConf, readOnlyConf });
    return view;
}

export function docOf(view) {
    return view.state.doc.toString();
}

/**
 * Replace the whole document without losing the undo history's identity as a
 * *new* document — used when switching tabs or reloading a file from disk.
 * No-ops when the text already matches, so it is safe to call from a reactive
 * statement.
 */
export function setDoc(view, text) {
    const current = view.state.doc.toString();
    if (current === text) return false;
    view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: EditorSelection.cursor(0),
        scrollIntoView: true,
    });
    return true;
}

export function setLanguage(view, path) {
    view.dispatch({ effects: confOf(view).languageConf.reconfigure(languageFor(path)) });
}

export function setTheme(view, theme, fontSize) {
    view.dispatch({ effects: confOf(view).themeConf.reconfigure(themeExtension(theme, fontSize)) });
}

export function setReadOnly(view, readOnly) {
    view.dispatch({ effects: confOf(view).readOnlyConf.reconfigure(EditorState.readOnly.of(readOnly)) });
}

/** Move the cursor to a 1-based line and centre it — used by search results. */
export function goToLine(view, line) {
    const total = view.state.doc.lines;
    const target = view.state.doc.line(Math.min(Math.max(1, line), total));
    view.dispatch({
        selection: EditorSelection.cursor(target.from),
        effects: EditorView.scrollIntoView(target.from, { y: 'center' }),
    });
    view.focus();
}

/** Current selection as text, plus its range — the hook for the AI actions. */
export function selectionOf(view) {
    const { from, to } = view.state.selection.main;
    return { from, to, text: view.state.sliceDoc(from, to) };
}

export function replaceRange(view, from, to, text) {
    view.dispatch({ changes: { from, to, insert: text } });
}
