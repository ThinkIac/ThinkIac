<script>
import { onMount } from "svelte";
    /**
     * CodeView — highlight "nas coxas" para JS / JSX / TS / TSX.
     *
     * Estratégia: UM passe de regex com grupos alternativos (comentários,
     * strings, template literals, números, keywords, tags JSX), na ordem
     * de prioridade certa, em vez de múltiplas passadas independentes que
     * se sobrescrevem (causa clássica de highlight quebrado dentro de
     * strings/comentários).
     *
     * Não é um parser real — é regex. Vai errar em casos patológicos
     * (ex.: regex literals ambíguas, template literals aninhados com
     * `${...}` complexo). Para isso, vale a pena trocar por algo como
     * Shiki/Prism no futuro. Aqui o objetivo é "bonito o suficiente" com
     * zero dependências.
     */

    export let lang = "js";
    export let code = "";
    export let source = "";

    const KEYWORDS = new Set([
        "abstract", "any", "as", "asserts", "async", "await", "break",
        "case", "catch", "class", "const", "continue", "debugger",
        "declare", "default", "delete", "do", "else", "enum", "export",
        "extends", "false", "finally", "for", "from", "function", "get",
        "if", "implements", "import", "in", "infer", "instanceof",
        "interface", "is", "keyof", "let", "module", "namespace", "never",
        "new", "null", "of", "private", "protected", "public", "readonly",
        "return", "set", "static", "super", "switch", "this", "throw",
        "true", "try", "type", "typeof", "undefined", "unique", "unknown",
        "var", "void", "while", "with", "yield", "satisfies",
    ]);

    const BUILTIN_TYPES = new Set([
        "string", "number", "boolean", "object", "symbol", "bigint",
        "Array", "Promise", "Map", "Set", "Record", "Partial", "Readonly",
        "Pick", "Omit", "React", "JSX",
    ]);

    // Token pattern única, em ordem de prioridade via alternância:
    // 1. comentário de linha   2. comentário de bloco
    // 3. template literal      4. string aspas duplas
    // 5. string aspas simples  6. número
    // 7. identificador/keyword 8. resto (pontuação, espaços, etc.)
    const TOKEN_RE =
        /(\/\/[^\n]*)|(\/\*[\s\S]*?\*\/)|(`(?:\\.|[^`\\])*`)|("(?:\\.|[^"\\])*")|('(?:\\.|[^'\\])*')|(\b\d+\.?\d*\b)|([A-Za-z_$][A-Za-z0-9_$]*)|([\s\S])/g;

    function escapeHtml(s) {
        return s
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    function highlight(src) {
        let html = "";
        let match;
        TOKEN_RE.lastIndex = 0;

        // Rastreamos o token anterior "significativo" (ignorando espaços)
        // para decidir, por exemplo, se um identificador é chamada de
        // função (seguido de `(`) ou uma tag JSX (precedido de `<`).
        let prevSignificant = "";

        while ((match = TOKEN_RE.exec(src)) !== null) {
            const [
                , lineComment, blockComment, template,
                dquote, squote, number, ident, other,
            ] = match;

            if (lineComment) {
                html += `<span class="tok-comment">${escapeHtml(lineComment)}</span>`;
            } else if (blockComment) {
                html += `<span class="tok-comment">${escapeHtml(blockComment)}</span>`;
            } else if (template) {
                html += `<span class="tok-string">${escapeHtml(template)}</span>`;
            } else if (dquote) {
                html += `<span class="tok-string">${escapeHtml(dquote)}</span>`;
            } else if (squote) {
                html += `<span class="tok-string">${escapeHtml(squote)}</span>`;
            } else if (number) {
                html += `<span class="tok-number">${escapeHtml(number)}</span>`;
                prevSignificant = number;
                continue;
            } else if (ident) {
                if (KEYWORDS.has(ident)) {
                    html += `<span class="tok-keyword">${ident}</span>`;
                } else if (BUILTIN_TYPES.has(ident)) {
                    html += `<span class="tok-type">${ident}</span>`;
                } else if (/^[A-Z]/.test(ident) && prevSignificant === "<") {
                    // <ComponentName ...> em JSX
                    html += `<span class="tok-jsx-tag">${ident}</span>`;
                } else if (/^[A-Z]/.test(ident)) {
                    html += `<span class="tok-class">${ident}</span>`;
                } else {
                    html += `<span class="tok-ident">${ident}</span>`;
                }
                prevSignificant = ident;
                continue;
            } else if (other) {
                html += escapeHtml(other);
                if (!/\s/.test(other)) {
                    prevSignificant = other;
                }
                continue;
            }

            prevSignificant = "";
        }

        return html;
    }

    $: highlighted = highlight(source ?? "");
    $: displayLang = (lang || "js").toUpperCase();
</script>

<div class="code-view">
    <div class="code-view__header">
        <span class="code-view__lang">{displayLang}</span>
    </div>
    <pre class="code-view__pre"><code class="code-view__code">{@html highlighted}</code></pre>
</div>

<style>
    .code-view {
        background: var(--tk-surface-2, var(--surface-2));
        border-radius: var(--tk-radius-md, var(--r));
        overflow: hidden;
        font-size: 13px;
        line-height: 1.5;
        border: 1px solid var(--tk-border, var(--border));
    }

    .code-view__header {
        display: flex;
        align-items: center;
        padding: 6px 12px;
        background: var(--tk-surface, var(--surface));
        border-bottom: 1px solid var(--tk-border, var(--border));
    }

    .code-view__lang {
        font-family: var(--tk-mono, var(--font-mono));
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.05em;
        color: var(--tk-muted, var(--txt-3));
    }

    .code-view__pre {
        margin: 0;
        padding: 14px 16px;
        overflow-x: auto;
    }

    .code-view__code {
        font-family: var(--tk-mono, var(--font-mono));
        white-space: pre;
        color: var(--tk-text, var(--txt));
    }

    :global(.code-view .tok-comment) {
        color: var(--tk-muted, var(--txt-3));
        font-style: italic;
    }
    :global(.code-view .tok-string) {
        color: var(--tk-text, var(--txt));
    }
    :global(.code-view .tok-number) {
        color: var(--tk-muted, var(--txt-2));
    }
    :global(.code-view .tok-keyword) {
        color: var(--tk-accent, var(--txt));
    }
    :global(.code-view .tok-type) {
        color: var(--tk-text, var(--txt));
    }
    :global(.code-view .tok-class) {
        color: var(--tk-text, var(--txt));
    }
    :global(.code-view .tok-jsx-tag) {
        color: var(--tk-text, var(--txt));
    }
    :global(.code-view .tok-ident) {
        color: var(--tk-text, var(--txt));
    }
</style>
