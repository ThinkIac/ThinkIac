/**
 * Inflect Template Engine
 * Lightweight recursive template renderer with includes, loops, conditionals, and expressions.
 * Works in both CommonJS and ES Modules.
 */

const fs = require('fs');
const path = require('path');

/**
 * Renders a template string using Inflect syntax.
 * @param {string} template - Template string content.
 * @param {object} [context={}] - Context object for variable bindings.
 * @param {string} [baseDir=process.cwd()] - Base directory for includes.
 * @returns {string} Rendered result.
 */
function renderTemplate(template, context = {}, baseDir = process.cwd()) {
    function evalInContext(expression) {
        try {
            const result = new Function(...Object.keys(context), `return ${expression}`)(
                ...Object.values(context)
            );
            // Se o resultado for null/undefined, devolve o placeholder original
            return result != null ? result : `{{${expression}}}`;
        } catch (e) {
            // Variável não encontrada — preserva o placeholder
            return `{{${expression}}}`;
        }
    }

    let output = template;

    // === Process {#include path} ===
    output = output.replace(/\{\{\s*([\s\S]+?)\s*\}\}/g, (match, expr) => {
        const val = evalInContext(expr.trim());
        return val !== undefined ? val : match; // devolve {{ code }} intacto
    });

    // === {#each array as item[, index]} ... {/each} ===
    output = output.replace(
        /\{#each\s+(\S+)\s+as\s+(\S+)(?:,\s*(\S+))?\}([\s\S]*?)\{\/each\}/g,
        (_, arrayName, itemName, indexName, inner) => {
            const arr = evalInContext(arrayName) || [];
            return arr.map((item, i) => {
                const subCtx = { ...context, [itemName]: item };
                if (indexName) subCtx[indexName] = i;
                return renderTemplate(inner, subCtx, baseDir);
            }).join('');
        }
    );

    // === {#if condition} {:else if cond} {:else} {/if} ===
    function processIfBlocks(template) {
        const ifRegex = /\{#if\s+([\s\S]+?)\}/;

        function renderBlock(str) {
            let result = '';
            let cursor = 0;

            while (cursor < str.length) {
                const match = ifRegex.exec(str.slice(cursor));
                if (!match) {
                    result += str.slice(cursor);
                    break;
                }

                const start = cursor + match.index;
                const condition = match[1].trim();
                let depth = 1;
                let endIndex = start + match[0].length;
                const elseRegex = /\{:else if\s+([\s\S]+?)\}|\{:else\}|\{\/if\}/g;
                let matches = [];
                elseRegex.lastIndex = endIndex;

                let m;
                while ((m = elseRegex.exec(str)) !== null) {
                    const tag = m[0];
                    if (tag.startsWith('{#if')) depth++;
                    else if (tag === '{/if}') depth--;

                    if (depth === 0) {
                        endIndex = m.index + m[0].length;
                        break;
                    } else {
                        matches.push({ match: m[0], index: m.index, groups: m.slice(1) });
                    }
                }

                const blocks = [];
                let elseIfs = [];
                let elseIndex = null;

                for (const b of matches) {
                    if (b.match.startsWith('{:else if')) {
                        elseIfs.push({ condition: b.groups[0], index: b.index });
                    } else if (b.match.startsWith('{:else}')) {
                        elseIndex = b.index;
                    }
                }

                let last = match.index + match[0].length;
                blocks.push({
                    condition,
                    content: str.slice(last, elseIfs.length ? elseIfs[0].index : (elseIndex ?? endIndex))
                });

                for (let i = 0; i < elseIfs.length; i++) {
                    const start = elseIfs[i].index + elseIfs[i].match?.length;
                    const end = i + 1 < elseIfs.length ? elseIfs[i + 1].index : (elseIndex ?? endIndex);
                    blocks.push({
                        condition: elseIfs[i].condition,
                        content: str.slice(start, end)
                    });
                }

                if (elseIndex !== null) {
                    blocks.push({
                        condition: null,
                        content: str.slice(elseIndex + 7, endIndex - 5)
                    });
                }

                let rendered = '';
                for (const block of blocks) {
                    if (block.condition === null || evalInContext(block.condition)) {
                        rendered = renderTemplate(block.content, context, baseDir);
                        break;
                    }
                }

                result += str.slice(cursor, start) + rendered;
                cursor = endIndex;
            }

            return result;
        }

        return renderBlock(template);
    }

    output = processIfBlocks(output);

    // === {#switch expr} {#case val} {/case} {:default} {/switch} ===
    const switchRegex = /\{#switch\s+([\s\S]+?)\}([\s\S]*?)\{\/switch\}/g;
    output = output.replace(switchRegex, (_, expr, inner) => {
        const val = evalInContext(expr);
        const caseRegex = /\{#case\s+([\s\S]+?)\}([\s\S]*?)\{\/case\}/g;
        let m;
        while ((m = caseRegex.exec(inner))) {
            const [_, caseVal, block] = m;
            if (evalInContext(caseVal) === val)
                return renderTemplate(block, context, baseDir);
        }
        const def = /\{:default\}([\s\S]*)/.exec(inner);
        if (def) return renderTemplate(def[1], context, baseDir);
        return '';
    });

    // === {{ expression }} interpolation ===
    output = output.replace(/\{\{\s*([\s\S]+?)\s*\}\}/g, (_, expr) => {
        const val = evalInContext(expr);
        return val != null ? val : '';
    });

    return output;
}

// ✅ CommonJS export
module.exports = { renderTemplate };

// ✅ ESM compatibility
module.exports.default = renderTemplate;
