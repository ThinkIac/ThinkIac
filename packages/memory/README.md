# memory

Memória de longo prazo do runtime — um grafo de **entidades**, **observações**
(fatos atômicos ligados a uma entidade) e **relações** entre entidades ("Alice"
--works_on--> "Projeto X"). É o "palácio da memória": em vez de uma lista
plana de fatos soltos, cada fato pertence a uma entidade, e entidades se
conectam entre si — a busca (`memory_recall`) devolve não só o fato mais
parecido, mas também as relações de 1 salto da entidade dona.

## Por que isso existe

Antes deste pacote, memória de longo prazo era duas implementações quase
idênticas e independentes:

- `apps/runtime/packages/agent/memory/session.js` — fatos em
  `aurora/memory/facts.md` (markdown plano, um `- [timestamp] texto` por
  linha) + embeddings em `aurora/memory/embeddings.json` (array JSON, busca
  por força bruta).
- `apps/runtime/packages/agentic/memory/session.js` — lia/escrevia o **mesmo**
  `facts.md` do aurora por um path hardcoded (`../../agent/memory/facts.md`),
  sem embeddings.

Nenhuma das duas tinha estrutura: era uma lista de linhas de texto, sem
entidades nem relações — não dava para perguntar "o que eu sei sobre X" nem
"o que está relacionado a Y". Escrita também era read-modify-write de arquivo
inteiro a cada chamada, sem lock (mesma classe de problema que motivou a
reescrita de `packages/bags` — ver o README de lá).

Este pacote substitui as duas por um único grafo em SQLite (via
`schema.prisma` + `getProxy('memory')`, a mesma camada usada por `bags`,
`whatsapp-manager`, etc.), com escrita atômica por linha.

## Modelo de dados (`schema.prisma`)

- **Entity**: `name`, `type` (person | project | preference | fact | task |
  event | concept | legacy | schedule), `summary` (resumo curto, reescrito
  por `consolidate()`), `importance`, `accessCount`, `lastAccessedAt`.
- **Observation**: `entityId`, `content`, `embedding` (JSON, opcional),
  `sessionId` (opcional), `source` (manual | migrated | consolidated |
  agentic).
- **Relation**: `fromEntityId`, `toEntityId`, `type` (texto livre: works_on,
  prefers, part_of, related_to, ...).

Unicidade (nome+tipo de entidade, triplas de relação) é garantida em
`lib/graph.js` via `findOne()` antes do `push()` — **não** por `@@unique`
composto. O parser Prisma deste runtime
(`packages/scriba/src/parser/Prisma.js`) só entende atributos de campo
(`@unique`, `@default`, ...); atributos de modelo (`@@...`) não são tratados
como um caso especial e acabam virando um campo incorreto. Evite `@@unique`
neste runtime — use um `findOne` antes do `push`, como aqui e em
`bags/tools.js`.

## Embeddings: best-effort, sem dependência dura

`lib/embedder.js` tenta importar `getEmbedding` de
`apps/runtime/packages/agent/llm/llm.js` dinamicamente (mesma fonte que
`aurora/memory/session.js` já usava). Se o aurora não estiver instalado, ou
não houver pool HTTP configurado para embeddings, `embed()` retorna `null` e
`recall()` degrada para busca por substring (SQL `LIKE`) — nunca quebra o
fluxo. Isso mantém o pacote `memory` sem dependência dura de nenhum
provider/agente específico (o mesmo princípio do módulo `db`: "scriba é peer
opcional").

## Tools (`tools.js`)

- `memory_remember({ content, entity?, type?, sessionId? })` — grava um fato,
  associado a uma entidade (padrão: `"general"`).
- `memory_relate({ from, type, to })` — cria uma relação dirigida entre duas
  entidades (cria as entidades se não existirem).
- `memory_recall({ query, limit?, entity?, pool? })` — busca semântica (ou
  substring) + relações de 1 salto da entidade de cada resultado. Escopada
  por `entity`, considera todo o histórico da entidade (sem cap); sem
  `entity` (busca global), ranqueia sobre um lote recente de tamanho `pool`
  (padrão 500 — ver § Fora de escopo).
- `memory_forget({ query })` — remove observações por substring; remove
  entidades que ficarem órfãs (sem observações nem relações).
- `memory_status()` — contagens do grafo.
- `memory_migrate_legacy_facts()` — importação única do `facts.md` +
  `embeddings.json` antigos do aurora (idempotente).
- `memory_extract({ text, sessionId? })` — extração automática de
  entidades/relações/fatos (NER) a partir de texto livre, via executor do
  logos com saída estruturada (`outputSchema`). **Opt-in**: só roda quando o
  agente decide chamar essa tool explicitamente; `memory_remember`/
  `memory_relate` continuam exigindo que o chamador já saiba o nome da
  entidade, sem NER automático embutido neles.

Como o `agentic` não descobre tools de pacotes automaticamente (mesma
limitação documentada em `packages/bags/README.md`), essas tools são
chamadas via `run_runtime_tool({ package: 'memory', tool: '<nome>', args })`.

## Hook (`hooks.js`)

`agent:prompt:compose` injeta um bloco compacto ("## Memória de longo prazo")
com as 5 entidades mais recentemente tocadas e a última observação de cada
uma — mesmo evento e mesmo espírito de teto fixo de `packages/bags/hooks.js`
(nunca reimprime o grafo inteiro). É disparado por
`apps/runtime/packages/agentic/core/loop.js` a cada iteração.

**O aurora não passa por este hook** — tem um loop próprio
(`aurora/core/agent.js`) que nunca dispara `agent:prompt:compose` pelo bus
(confirmado: nenhum `dispatchEvent` nesse arquivo). Lá a memória entra por
import direto: `aurora/memory/session.js` e `aurora/core/builtin_tools.js`
(tools nativas `remember`/`recall`/`forget`) agora delegam para
`lib/graph.js` deste pacote em vez de ler `facts.md`/`embeddings.json`
diretamente — ver os comentários nesses arquivos.

## Migração dos dados antigos

`memory_migrate_legacy_facts` lê `aurora/memory/facts.md` linha por linha,
casa cada linha por texto com uma entrada de `aurora/memory/embeddings.json`
(se existir, para não perder o embedding já calculado) e grava tudo como
`Observation`s da entidade `"legacy"` (`source: "migrated"`). É idempotente
(não roda duas vezes — checa se já existe alguma observação com
`source: "migrated"`). Os arquivos antigos **não são apagados** — ficam
inertes em disco após a migração; apague manualmente depois de conferir que
o grafo tem os dados esperados (`memory_status`).

Entidades/relações novas só existem daqui pra frente — a migração não tenta
extrair entidades/relações do texto plano antigo (seria adivinhação; melhor
deixar o agente popular o grafo de verdade usando `memory_remember`/
`memory_relate` a partir de agora).

## Consolidação (`consolidate()`)

Equivalente ao `compressFacts()` antigo do aurora (que já estava morto — só
tinha uma chamada comentada em `agent.js`), mas por entidade: quando uma
entidade acumula mais de `threshold` observações (padrão 30), resume as mais
antigas via LLM (`callLLM` é injetado pelo chamador — o pacote `memory` não
tem LLM próprio) e substitui por uma única observação `source: "consolidated"`,
mantendo as `keepRecent` mais recentes intactas. Não é chamado
automaticamente por nenhum hook ainda — fica disponível para quem quiser
agendar via `scheduler` ou chamar sob demanda.

## Fora de escopo (não implementado aqui)

- Views Svelte / UI de navegação do grafo — `routes.js` expõe
  `GET /memory/api/entities`, `/api/search` e `/api/status` somente-leitura
  para uma futura UI, mas nenhuma view foi construída (mesma decisão que
  `packages/bags` tomou para sua própria lista de sessões).
- Índice vetorial nativo (ANN) — para busca **global** (sem `entity`),
  `recall()` ainda ranqueia por cosine similarity em JS sobre um lote recente
  (`pool`, padrão 500), não um índice real; não escala para milhões de
  observações. Busca **escopada** por `entity` não tem esse cap (o SQL já
  filtra por `entityId` antes do ranqueamento, e o grafo de uma entidade é
  pequeno por design), então esse limite só importa em buscas sem escopo.
- Sessões de conversa (histórico de mensagens, resumo por sessão) —
  continuam em `aurora/memory/session.js` / `agentic/memory/session.js`
  (`getSession`/`pushMessage`/`compressIfNeeded`), que é um problema
  diferente (memória de trabalho de uma conversa, não memória de longo
  prazo) e não foi tocado por este pacote além dos pontos de delegação de
  fatos citados acima.
