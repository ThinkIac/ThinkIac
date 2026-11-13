# Governance

Camada determinística de segurança para ações do agente. Classifica cada ação
como `safe`, `needs_confirmation` ou `blocked`; as confirmações são vinculadas
ao hash da ação e só podem ser resolvidas uma vez via StructuredInput.

O enforcement ocorre no loop do Aurora antes da execução. O hook `tool_before`
apenas observa integrações externas e nunca tenta pausar processos que não
ofereçam contrato de retomada.

Regras iniciais: consultas são seguras; escrita, rede, custo e execução exigem
confirmação; segredos, bypasses e operações irreversíveis específicas bloqueiam.
Os argumentos são redigidos na auditoria.

## Modos de aprovação por sessão

Cada sessão escolhe, na InputBar, como as ações são aprovadas. A policy fica em
`data/policies.json` (config de UI, fora da auditoria) e é aplicada por cima da
classificação determinística do engine:

| Modo | Comportamento |
| --- | --- |
| `auto` | Executa direto o que exigiria confirmação e registra como risco assumido. O que é `blocked` (segredos, bypass) continua bloqueado. |
| `semi` (default) | Uma LLM classifica ações permitidas pelo preset, e a matriz determinística aplica o limite. Falha de LLM ou resposta inválida sempre pede confirmação. |
| `manual` | Toda ação que altera estado precisa de aprovação; leituras (`get`/`list`/`read`/…) passam direto. |

Presets do modo `semi`:

| Preset | Comportamento |
| --- | --- |
| `read_only` (default) | Apenas leituras comprovadas são executadas. Qualquer alteração, execução, custo ou efeito externo pede aprovação. |
| `workspace_edits` | A LLM pode liberar apenas criações e edições locais no workspace. Exclusões, movimentos, execução, rede e publicação continuam pedindo aprovação. |
| `custom` | A LLM avalia o texto da política do usuário; ações ambíguas continuam pedindo aprovação. |

Rotas: `GET /governance/policy?sessionId=…` e
`POST /governance/policy { sessionId, mode, preset, prompt }`.

O card de confirmação carrega o comando real (`pacote.tool`) e cada argumento
já redigido — a UI mostra os parâmetros, não uma pergunta genérica.
