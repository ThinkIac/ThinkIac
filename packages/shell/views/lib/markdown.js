import katex from "katex";
import { Marked } from "marked";

const ADMONITION_LABELS = {
    NOTE: "Nota",
    TIP: "Dica",
    IMPORTANT: "Importante",
    WARNING: "Warning",
    CAUTION: "Cuidado",
};

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function safeUrl(value) {
    const url = String(value ?? "").trim();
    if (/^(?:javascript|data|vbscript):/i.test(url)) return "";
    return escapeHtml(url);
}

const renderer = {
    html(text) {
        return escapeHtml(text);
    },
    link(href, title, text) {
        const url = safeUrl(href);
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        return `<a href="${url}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
    image(href, title, text) {
        const url = safeUrl(href);
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        return `<img src="${url}" alt="${escapeHtml(text)}"${titleAttr} loading="lazy">`;
    },
};

const parser = new Marked({
    async: false,
    breaks: true,
    gfm: true,
    renderer,
});

function protectMath(source, stash) {
    const save = (tex, display) => {
        let html;
        try {
            html = katex.renderToString(tex.trim(), {
                throwOnError: false,
                displayMode: display,
            });
        } catch {
            html = escapeHtml(display ? `$$${tex}$$` : `$${tex}$`);
        }
        stash.push(html);
        return `\u0002MATH${stash.length - 1}\u0002`;
    };

    return source
        .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => save(tex, true))
        .replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) => save(tex, true))
        .replace(/\\\(([\s\S]+?)\\\)/g, (_, tex) => save(tex, false))
        .replace(/\$([^\n$]+?)\$/g, (_, tex) => save(tex, false));
}

function extractFootnotes(source) {
    const definitions = new Map();
    const withoutDefinitions = source.replace(
        /^\[\^([^\]]+)\]:[ \t]*(.+)$/gm,
        (_, id, text) => {
            definitions.set(id, text.trim());
            return "";
        },
    );
    const used = [];
    const body = withoutDefinitions.replace(/\[\^([^\]]+)\]/g, (match, id) => {
        if (!definitions.has(id)) return match;
        if (!used.includes(id)) used.push(id);
        const number = used.indexOf(id) + 1;
        return `<sup class="footnote-ref"><a href="#fn-${escapeHtml(id)}" id="fnref-${escapeHtml(id)}">${number}</a></sup>`;
    });
    return { body, definitions, used };
}

function renderFootnotes(definitions, used) {
    if (!used.length) return "";
    const items = used
        .map((id, index) => {
            const content = parser.parseInline(definitions.get(id));
            return `<li id="fn-${escapeHtml(id)}"><span class="footnote-num">${index + 1}.</span> ${content} <a href="#fnref-${escapeHtml(id)}" class="footnote-back">↩</a></li>`;
        })
        .join("");
    return `<div class="footnotes"><hr><ol class="footnotes-list">${items}</ol></div>`;
}

function protectAdmonitions(source, stash) {
    return source.replace(
        /^(?:[ \t]*>.*(?:\n|$))+/gm,
        (block) => {
            const lines = block.replace(/\n$/, "").split("\n");
            const stripped = lines.map((line) => line.replace(/^[ \t]*>[ ]?/, ""));
            const match = stripped[0]?.trim().match(/^\[!(\w+)\]$/i);
            if (!match) return block;
            const type = match[1].toUpperCase();
            const label = ADMONITION_LABELS[type] || escapeHtml(type);
            const body = parser.parse(stripped.slice(1).join("\n"));
            stash.push(
                `<div class="admonition admonition-${type.toLowerCase()}"><div class="admonition-title">${label}</div><div class="admonition-body">${body}</div></div>`,
            );
            return `\u0002ADMONITION${stash.length - 1}\u0002\n`;
        },
    );
}

function restorePlaceholders(html, name, values) {
    return html.replace(
        new RegExp(`(?:<p>)?\\u0002${name}(\\d+)\\u0002(?:<\\/p>)?`, "g"),
        (_, index) => values[Number(index)] ?? "",
    );
}

function styleTaskLists(html) {
    const taskItem =
        /<li><input( checked="")? disabled="" type="checkbox"> ([\s\S]*?)<\/li>/g;
    const withItems = html.replace(taskItem, (_, checked, text) => {
        const state = checked ? " checked" : "";
        const tick = checked
            ? '<svg viewBox="0 0 12 12" fill="none" width="9" height="9" aria-hidden="true"><path d="M2 6l3 3 5-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
            : "";
        return `<li class="task-item"><span class="task-checkbox${state}">${tick}</span><span class="task-text">${text}</span></li>`;
    });
    return withItems.replace(
        /<ul>\n(?=<li class="task-item">)/g,
        '<ul class="task-list">\n',
    );
}

function renderMarkdownUncached(raw) {
    if (!raw) return "";

    const math = [];
    const admonitions = [];
    const media = [];
    const footnotes = extractFootnotes(String(raw));
    let source = protectMath(footnotes.body, math);
    source = protectAdmonitions(source, admonitions);
    source = source.replace(
        /!\[([^\]]*)\]\(([^)\s]+)\)\{width=(\d+)\}/g,
        (_, alt, url, width) => {
            media.push(
                `<img src="${safeUrl(url)}" alt="${escapeHtml(alt)}" width="${Number(width)}" loading="lazy">`,
            );
            return `\u0002MEDIA${media.length - 1}\u0002`;
        },
    );

    let html = parser.parse(source);
    html = restorePlaceholders(html, "MATH", math);
    html = restorePlaceholders(html, "ADMONITION", admonitions);
    html = restorePlaceholders(html, "MEDIA", media);
    html = styleTaskLists(html);
    return html + renderFootnotes(footnotes.definitions, footnotes.used);
}

export { escapeHtml };

// Small per-module cache; long streaming answers cannot grow it without bound.
const markdownCache = new Map();
let markdownCacheBytes = 0;
export function renderMarkdown(raw) {
    if (!raw) return "";
    const key = String(raw);
    const cached = markdownCache.get(key);
    if (cached !== undefined) return cached;
    const html = renderMarkdownUncached(key);
    const bytes = (key.length + html.length) * 2;
    if (bytes <= 128000) {
        while (markdownCache.size >= 128 || markdownCacheBytes + bytes > 2000000) {
            const first = markdownCache.keys().next().value;
            markdownCacheBytes -= (first.length + markdownCache.get(first).length) * 2;
            markdownCache.delete(first);
        }
        markdownCache.set(key, html);
        markdownCacheBytes += bytes;
    }
    return html;
}
