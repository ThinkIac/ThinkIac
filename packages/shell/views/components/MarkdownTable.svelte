<script>
    /** 
     * Recebe o bloco markdown da tabela como string e renderiza
     * como uma tabela estilizada seguindo o design system do Agent.
     * 
     * @prop {string} raw — o bloco markdown completo da tabela (linhas com |)
     */
    export let raw = '';

    // ── Parser ──────────────────────────────────────────────────────
    function parseMarkdownTable(src) {
        const lines = src.trim().split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) return null;

        const parseRow = (line) =>
            line.replace(/^\||\|$/g, '').split('|').map(c => c.trim());

        const isSeperator = (line) => /^[\|\s\-:]+$/.test(line);

        const headers = parseRow(lines[0]);
        if (!isSeperator(lines[1])) return null;

        // Detecta alinhamento a partir da linha de separador
        const alignRow = parseRow(lines[1]);
        const aligns = alignRow.map(cell => {
            if (/^:-+:$/.test(cell)) return 'center';
            if (/^-+:$/.test(cell))  return 'right';
            return 'left';
        });

        const rows = lines.slice(2).map(parseRow);

        return { headers, aligns, rows };
    }

    $: table = parseMarkdownTable(raw);

    // Detecta se uma célula é numérica para aplicar font-mono
    function isNumeric(val) {
        return val !== '' && !isNaN(Number(val.replace(/[%$,]/g, '')));
    }
</script>

{#if table}
    <div class="mt-table-wrap">
        <!-- scroll horizontal em telas pequenas -->
        <div class="mt-scroll">
            <table class="mt-table">
                <thead>
                    <tr>
                        {#each table.headers as header, i}
                            <th
                                class="mt-th"
                                style="text-align: {table.aligns[i]}"
                            >
                                {header}
                            </th>
                        {/each}
                    </tr>
                </thead>
                <tbody>
                    {#each table.rows as row, ri}
                        <tr class="mt-tr" class:mt-tr-even={ri % 2 === 0}>
                            {#each table.headers as _, ci}
                                {@const cell = row[ci] ?? ''}
                                {@const numeric = isNumeric(cell)}
                                <td
                                    class="mt-td"
                                    class:mt-td-numeric={numeric}
                                    style="text-align: {table.aligns[ci]}"
                                >
                                    {cell}
                                </td>
                            {/each}
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
        <p class="mt-meta">{table.rows.length} linha{table.rows.length !== 1 ? 's' : ''} · {table.headers.length} colunas</p>
    </div>
{/if}

<style>
    .mt-table-wrap {
        margin: 10px 0;
        border-radius: var(--r-lg);
        border: 1px solid var(--border);
        background: var(--surface);
        overflow: hidden;
    }

    .mt-scroll {
        overflow-x: auto;
        /* scrollbar fina no estilo do shell */
        scrollbar-width: thin;
        scrollbar-color: var(--border) transparent;
    }

    .mt-scroll::-webkit-scrollbar {
        height: 4px;
    }
    .mt-scroll::-webkit-scrollbar-track {
        background: transparent;
    }
    .mt-scroll::-webkit-scrollbar-thumb {
        background: var(--border-hi);
        border-radius: 2px;
    }

    .mt-table {
        width: 100%;
        border-collapse: collapse;
        font-family: var(--font-body);
        font-size: 13px;
        color: var(--txt);
        min-width: 360px;
    }

    /* ── Header ── */
    .mt-th {
        padding: 10px 14px;
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--txt-2);
        background: var(--surface-2);
        border-bottom: 1px solid var(--border);
        white-space: nowrap;
    }

    /* Primeira coluna levemente destacada */
    .mt-th:first-child,
    .mt-td:first-child {
        padding-left: 16px;
    }
    .mt-th:last-child,
    .mt-td:last-child {
        padding-right: 16px;
    }

    /* ── Rows ── */
    .mt-tr {
        border-bottom: 1px solid var(--border);
        transition: background 0.1s;
    }
    .mt-tr:last-child {
        border-bottom: none;
    }
    .mt-tr:hover {
        background: var(--accent-dim);
    }
    .mt-tr-even {
        background: var(--w015, rgba(255, 255, 255, 0.015));
    }

    /* ── Cell ── */
    .mt-td {
        padding: 9px 14px;
        color: var(--txt);
        vertical-align: middle;
        line-height: 1.5;
    }

    /* Células numéricas ficam em mono */
    .mt-td-numeric {
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--txt-2);
        letter-spacing: 0.02em;
    }

    /* ── Meta footer ── */
    .mt-meta {
        padding: 5px 16px 6px;
        font-family: var(--font-mono);
        font-size: 10px;
        color: var(--txt-3);
        letter-spacing: 0.04em;
        background: var(--surface-2);
        border-top: 1px solid var(--border);
    }

    /* ── Mobile ── */
    @media (max-width: 767px) {
        .mt-th,
        .mt-td {
            padding: 8px 10px;
            font-size: 12px;
        }
        .mt-th:first-child,
        .mt-td:first-child {
            padding-left: 12px;
        }
    }
</style>
