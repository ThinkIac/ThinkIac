# Thinkiac — Convenções para agentes

## Preservação e evolução segura

Funcionalidades existentes, inclusive as não documentadas, são requisitos de
compatibilidade. Antes de alterar uma área, localize e descreva o comportamento
atual, seus pontos de entrada e as validações já existentes.

- Prefira a menor mudança compatível: estenda o código, contratos e dados atuais
  antes de criar pacotes, substituir arquitetura ou reescrever uma área inteira.
- Não apague, renomeie, mova, desative nem substitua código, rotas, views, tools,
  eventos ou dados funcionais sem autorização explícita do usuário.
- Uma refatoração é permitida quando preserva o comportamento observável. Se a
  substituição for necessária, mantenha uma camada de compatibilidade ou uma
  migração segura e valide as capacidades anteriores antes de concluir.
- Cada mudança deve incluir uma verificação proporcional das funcionalidades
  afetadas. Uma feature que já funcionava não pode deixar de existir por falta de
  documentação ou por conveniência de implementação.
- Evolua de forma incremental e reversível. Isso não impede melhorias nem exige
  criar vários pacotes: use a estrutura existente quando ela atender ao caso.

## Tema Thinkiac (Dark/White)

Todo pacote com UI **deve** seguir o mesmo tema Dark/White. Não use cores hardcoded
(ex.: `#1e1e1e`, `#007acc`) — use os tokens abaixo.

### Fonte única de verdade
- O tema fica em `localStorage['agent:theme']` com valor `'dark'` (default) ou `'light'`.
- Leitura/escrita canônica: `packages/agent/views/theme.js` (`getTheme()` / `setTheme()`).
- O **toggle** canônico vive em `packages/agent/views/Sidebar.svelte`.

### Como uma view aplica o tema
1. Aplique `data-theme="dark|light"` no container raiz da view.
2. Declare os tokens `--tk-*` para `[data-theme="dark"]` e `[data-theme="light"]` (valores abaixo).
   São os mesmos valores usados pelo Agent nos `--agent-*` (que ficam como **alias legado**;
   não renomeie os `--agent-*` existentes).
3. **Views fora do `.shell` do Agent** (ex.: `packages/terminal`, que é fullscreen `100dvh` e não
   herda os tokens do `.shell`): leiam o tema de `localStorage['agent:theme']` no mount e ouçam
   `window.addEventListener('storage', …)` na key `agent:theme` para sincronizar ao vivo quando o
   tema for trocado em outra view (Sidebar). Referência de implementação: `packages/terminal/views/Index.svelte`.

### Tokens canônicos `--tk-*`

| Token | Dark | Light |
|---|---|---|
| `--tk-bg` | `#111111` | `#ffffff` |
| `--tk-surface` | `#181818` | `#f5f5f5` |
| `--tk-surface-2` | `#1f1f1f` | `#ececec` |
| `--tk-border` | `rgba(255,255,255,.09)` | `rgba(0,0,0,.10)` |
| `--tk-border-hi` | `rgba(255,255,255,.16)` | `rgba(0,0,0,.18)` |
| `--tk-text` | `#f5f5f5` | `#1a1a1a` |
| `--tk-muted` | `#888888` | `#666666` |
| `--tk-muted-2` | `rgba(136,136,136,.5)` | `rgba(0,0,0,.4)` |
| `--tk-accent` | `#f5f5f5` | `#111111` |
| `--tk-on-accent` | `#111111` | `#ffffff` |
| `--tk-radius-md` | `8px` | `8px` |
| `--tk-radius-lg` | `14px` | `14px` |
| `--tk-font` | `'Ubuntu', system-ui, sans-serif` | idem |
| `--tk-mono` | `'Ubuntu Mono', monospace` | idem |

Fonte carregada via Google Fonts (pesos 300/400/500/700 + Ubuntu Mono 400/700) — ver `@import` no
`<style>` de `packages/agent/views/Home.svelte`.

### Regras de estilo (do DESIGN.md do Agent)
- **Sem emojis na UI** — use ícones SVG inline (`stroke="currentColor"`), sem lib de ícones.
- Cores **flat**, sem gradientes decorativos.
- Sombras no claro `≤ 0 2px 8px rgba(0,0,0,.08)`; sem glows externos.
- Nada de preto puro `#000000`.
- **Motion**: só `transform`/`opacity`, 200–300ms, ease-out.
- Radius `--tk-radius-md`/`--tk-radius-lg`.
- Use `100dvh` (nunca `100vh`/`h-screen`) para layouts fullscreen.

## Terminal — atalhos mobile

A view `packages/terminal/views/Index.svelte` usa uma **barra de teclado ancorada** acima do teclado
virtual (posicionada via `window.visualViewport`), fina e rolável, com _progressive disclosure_
(chevron expande a segunda linha). Só aparece em `pointer: coarse` ou largura ≤ 820px. Ao mexer nela,
mantenha `on:mousedown={keepFocus}` nos botões (evita perder o foco do textarea do xterm e fechar o teclado).
