




















/** Prefixo de shell. `!!` é o isolado e precisa ser testado ANTES de `!`. */
const SHELL_RE = /^(!!?)\s*([\s\S]+)$/;

/** `/comando resto da linha` */
const SLASH_RE = /^\/([a-zA-Z][\w-]*)\s*([\s\S]*)$/;

/**
 * Referências: `@caminho/do/arquivo` e `#pacote`.
 *
 * O `@` aceita caminho com barra e ponto (é um arquivo), mas para no espaço.
 * Ficam de fora e-mails (`x@y`) porque exigimos que o `@` comece o token.
 */
const REF_RE = /(^|\s)([@#])([\w./-]+)/g;

/** Comandos nativos. Pacotes acrescentam os deles via `manifest.inputbar.command`. */
export const NATIVE_COMMANDS = [
    {
        name: "usage",
        summary: "Uso desta sessão",
        detail: "Tokens e custo acumulados na sessão atual, por modelo.",
    },
    {
        name: "btw",
        summary: "Pergunta fora de banda",
        detail:
            "Pergunta rápida que NÃO entra na fila nem interrompe o turno em andamento. Usa o contexto da sessão e responde à parte.",
        takesArgs: true,
    },
];

/**
 * Divide o texto em referências + o texto sem elas.
 *
 * O texto continua legível depois de tirar as referências: elas são
 * substituídas pelo próprio nome, não apagadas — quem lê a mensagem depois
 * precisa entender a frase.
 */
export function extractReferences(text = "") {
    const refs = [];
    const limpo = String(text).replace(REF_RE, (match, espaco, marca, alvo) => {
        refs.push({ kind: marca === "@" ? "file" : "package", target: alvo });
        return `${espaco}${alvo}`;
    });
    return { refs, text: limpo };
}

/**
 * Interpreta o que o usuário digitou.
 *
 * Devolve sempre a mesma forma, com `kind` dizendo o que fazer:
 *   - `shell`   → { command, isolated }
 *   - `command` → { name, args }
 *   - `message` → texto normal (podendo ter referências)
 *
 * Nunca lança: entrada malformada vira mensagem comum. Um erro de digitação
 * não pode derrubar o envio — no pior caso o texto vai como texto.
 */
export function parseInput(raw = "", { commands = NATIVE_COMMANDS } = {}) {
    const texto = String(raw ?? "");
    const trimmed = texto.trim();

    if (!trimmed) return { kind: "message", text: texto, refs: [] };

    const shell = SHELL_RE.exec(trimmed);
    if (shell) {
        const [, marca, comando] = shell;
        return {
            kind: "shell",
            
            isolated: marca === "!!",
            command: comando.trim(),
            refs: [],
        };
    }

    const slash = SLASH_RE.exec(trimmed);
    if (slash) {
        const [, nome, resto] = slash;
        const conhecido = commands.find((c) => c.name === nome.toLowerCase());
        if (!conhecido) {
            
            
            
            return {
                kind: "unknown-command",
                name: nome.toLowerCase(),
                text: texto,
                refs: [],
            };
        }
        return {
            kind: "command",
            name: conhecido.name,
            args: resto.trim(),
            spec: conhecido,
            refs: [],
        };
    }

    const { refs, text } = extractReferences(texto);
    return { kind: "message", text, refs };
}

/**
 * Sugestões para o autocomplete, dado o que já foi digitado.
 * O cliente só desenha — quem decide o que existe é o servidor.
 */
export function suggest(prefix = "", { commands = NATIVE_COMMANDS } = {}) {
    const texto = String(prefix ?? "").trim();

    if (texto.startsWith("!")) {
        return [
            { insert: "!", label: "!", summary: "Shell na sessão" },
            { insert: "!!", label: "!!", summary: "Shell isolado (descartável)" },
        ].filter((s) => s.insert.startsWith(texto.slice(0, 2)) || texto === "!");
    }

    if (!texto.startsWith("/")) return [];

    const termo = texto.slice(1).toLowerCase();
    return commands
        .filter((c) => c.name.startsWith(termo))
        .map((c) => ({
            insert: `/${c.name}`,
            label: `/${c.name}`,
            summary: c.summary,
            detail: c.detail ?? null,
        }));
}

/**
 * Junta comandos nativos com os declarados por pacotes
 * (`manifest.inputbar.command`), sem deixar um pacote sequestrar um nativo.
 */
export function mergeCommands(packageCommands = []) {
    const nativos = new Map(NATIVE_COMMANDS.map((c) => [c.name, c]));
    const extras = [];

    for (const cmd of packageCommands) {
        const name = String(cmd?.name || "").replace(/^\//, "").toLowerCase();
        if (!name || nativos.has(name)) continue; 
        extras.push({
            name,
            summary: cmd.summary || cmd.label || name,
            detail: cmd.detail ?? null,
            pkg: cmd.pkg ?? null,
            event: cmd.event ?? null,
            takesArgs: !!cmd.takesArgs,
        });
    }

    return [...NATIVE_COMMANDS, ...extras];
}
