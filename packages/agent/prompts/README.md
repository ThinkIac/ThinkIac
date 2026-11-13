# Organização dos prompt parts

A base permanente contém identidade, autorização, honestidade, conclusão e
comunicação. Protocolos ampliam essa base sem repetir suas regras. Contexto da
sessão, ferramentas, memória e recibos são fornecidos pelo host.

## Composição atual

`core/agent.js`, em `loadPersonalityByApproximationLevel`, delega a leitura a
`core/prompt_parts.js` a cada composição: compact usa identity e communication; detailed acrescenta
structured-input, react e best-practices; full acrescenta multi-step e runtime.
`system.inflect` posiciona as seções dinâmicas. `AGENT.md` da Agent também serve
como fallback de personalidade. Preserve os placeholders e os consumidores ao
alterar esse contrato.

`core/skills.js` descobre AGENT.md pelo scanner de specialists e classifica os
candidatos por relevância. Engineer usa `always: false` e uma descrição de domínio.
Pedidos explícitos reconhecidos por `explicitDevelopmentSkill` ativam Engineer
mesmo quando o classificador falha. Essa regra limitada exige ação e assunto de
desenvolvimento; não deduz a tarefa a partir de “continue”. As demais mensagens
continuam passando pelo classificador. O corpo é renderizado novamente a cada composição, mesmo quando a
decisão vem do cache. Contratos de capacidade são consultados sob demanda.

## Responsabilidades

| Arquivo | Responsabilidade |
|---|---|
| core/identity.inflect | Identidade, autorização, evidência e uso criterioso de contexto |
| core/communication.inflect | Idioma, progresso, perguntas e entrega |
| protocols/structured-input.inflect | Formato de pergunta quando ela for necessária |
| protocols/react.inflect | Execução, inspeção de resultados e recuperação |
| protocols/multi-step.inflect | Plano proporcional, persistência e retomada |
| capabilities/runtime.inflect | Uso do catálogo, artefatos e formatos da interface |
| heuristics/best-practices.inflect | Descoberta, memória e dependências |
| system.inflect | Composição dos dados atuais fornecidos pelo host |

## Critérios e compatibilidade

A revisão proporcional preserva ES Modules, acessibilidade, contratos por
capacidade, ferramentas do Engineer, formato StructuredInput e renderizadores.
Elimina aprovação repetida, narrativa por chamada, ferramentas presumidas e
instruções conflitantes para HTML. Não muda armazenamento nem filtros automáticos
de memória: as regras de seleção e registro são orientações ao agente.

Recibos continuam sob `core/stability_receipts.js`, com validade de 24 horas.
A base delimita o uso ao trabalho correspondente; não confunda orientação textual
com mudança no mecanismo de atribuição, expiração ou publicação.

Referências consultadas: `packages/engineer/docs/agent-md-system.md`,
`packages/artifacts/AGENT.md`, `packages/agent/core/skills.js`,
`packages/specialists/lib/discovery.js` e o compositor em `core/agent.js`.
Valide alterações com renderização Inflect dos corpos reais e as suítes
`test/skills_inflect.test.js`, `core/stability_receipts.test.js` e
`../engineer/test/tool_schema.test.mjs`. Testes locais não comprovam aceite do
Stabilizer nem qualidade de seleção do classificador em produção.

## Proveniência por composição

Cada part declara no catálogo ordenado de `core/prompt_parts.js` sua finalidade
e os níveis de ativação. O trace registra caminho, hash SHA-256 do conteúdo
usado, nível e validade `composition`. A leitura não é cacheada: uma edição passa
a ter outro hash na composição seguinte. Falha de leitura mantém o fallback
completo do AGENT.md, identificado como tal. A personalidade continua obrigatória
no orçamento, com a ordem e os placeholders existentes preservados.

O trace também registra IDs, origens e motivos dos fragmentos descartados, além
do excesso de orçamento obrigatório, sem guardar seus conteúdos. Skills cortadas
pelo orçamento não aparecem como fontes utilizadas. A classificação distingue
`routingStatus` do status efetivo e lista ativações explícitas em `explicit`.
