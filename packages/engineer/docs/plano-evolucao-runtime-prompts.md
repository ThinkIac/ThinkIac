# Plano de evolução do Engineer, prompts e evidências do Runtime

Data: 2026-09-08. Estado: implementação parcial em andamento, sem ativação comprovada.

## Retomada da implementação

Implementado e verificado nesta continuação:

- Registro persistente de alterações locais por sessão, execução, tarefa,
  operação e hash de arquivo, com deduplicação. Corrigida a chamada do agente
  a `recordLocalChange`, antes inexistente. Falhar ao armazenar evidência não
  transforma uma escrita já concluída em falha que induza repetição.
- Correlação no Stabilizer por hash exato dos arquivos da transação. Autores
  são contribuintes identificados, não proprietários exclusivos do pacote.
  Evidência ausente, conteúdo divergente ou edição externa permanece sem autoria.
- Projeção e prompt preservam a ordem dos eventos por candidato. Divergência
  de hashes impede comprovação de aceite; histórico continua consultável.
- Tool `get_delivery_evidence` consulta alterações, projeções e recibos por
  sessão e execução/tarefa, sem criar rotas.
- Testes de retomada, isolamento, duplicidade, eventos atrasados, identidade
  divergente, fronteiras de contexto, orçamento obrigatório e manifesto.

Validação desta continuação: 49 testes Node e 17 testes Vitest aprovados;
TypeScript do Logos aprovado com `tsc --noEmit`. Não houve build de distribuição,
reinício nem confirmação de ativação no Runtime.

Pendências do plano completo: persistir a correlação no produtor entre reinícios;
associar explicitamente tarefas entre runs; completar os eixos de validação local
por candidato; metadados individuais dos prompt parts; seleção determinística
de Engineer; autorizações de escopo, classificação completa de memória e demais
cenários integrados de contratos. O mapa de correlação em memória do Stabilizer
é conservador após reinício: perde atribuição, sem inventá-la por horário.
As seções seguintes preservam o diagnóstico e os critérios do plano original.

## Objetivo e limites

Transformar as orientações já revisadas em comportamento verificável: atribuir
evidências ao trabalho correto, preservar autorização, selecionar contexto útil
e informar a situação real de cada entrega. Evoluir os componentes existentes,
sem criar outro orquestrador, compilador ou sistema paralelo de permissões.

A revisão cobriu os pontos de entrada e dependências abaixo, por leitura integral
dos módulos centrais e inspeção dirigida dos arquivos maiores. Não é uma auditoria
de todos os pacotes do monorepo. Dados privados e credenciais não foram necessários.
O recibo de whatsapp-manager não pertence a este trabalho e não será reparado aqui.

## Mapa da revisão e diagnóstico

Caminhos de pacotes nesta seção são relativos a apps/thinkiac/packages.

| Área e arquivos | Comportamento observado e consequência |
| --- | --- |
| engineer/AGENT.md, engineer/docs/agent-md-system.md, engineer/docs/events.md, engineer/index.js, engineer/test/tool_schema.test.mjs | O protocolo já dimensiona plano e validação pelo impacto. As ferramentas e checkpoints devem ser preservados. A próxima etapa exige mecanismos e testes, não outra reescrita geral do texto. |
| aurora/AGENT.md, aurora/prompts/README.md, system.inflect e sete parts | Há divisão de responsabilidades e níveis compact/detailed/full. Precisam de regressão integrada com o contexto dinâmico e fallback. |
| aurora/core/agent.js, context_compiler.js e context_compiler.test.js | Já existem fragmentos com origem, prioridade, confiança, deduplicação, expiração e orçamento. A composição inspecionada não fornece validade por recibo nem metadados individuais para cada part. O corte por caracteres pode interromper delimitadores de conteúdo externo. |
| aurora/core/skills.js e aurora/test/skills_inflect.test.js | Seleção por classificador com cache e renderização dinâmica. Engineer não é uma inclusão determinística para toda tarefa de desenvolvimento. |
| aurora/core/stability_receipts.js, stability_receipts.test.js, aurora/hooks/index.js | Atribuição por pacote citado e janela de cinco minutos. TTL de 24 horas. Nova mutação potencial elimina recibos da sessão; seleção retorna um recibo. Rejeição sem autoria entra como fallback global com instrução para corrigir. Não há identidade de conteúdo do candidato. |
| aurora/core/execution_context.js, execution_kernel.js, durable_runs.js e integração em agent.js | Já existem runId, turnId e operationId e persistência de execução. Reutilizar essa correlação; estado do turno não equivale ao estado da entrega. agent:tool-start é emitido antes da decisão de governança, portanto não comprova escrita. |
| aurora/core/tool_outcome.js e tool_outcome.test.js | Já há normalização de sucesso, erro, retryable, categoria e changedState, com adaptação legada. Ampliar adoção e informação útil, mantendo consumidores existentes. |
| governance/README.md, lib/engine.js, lib/policy.js; aurora/core/pending_permissions.js e chamadas em agent.js | Há modos por sessão, hash de ação e aprovação consumível. A orientação textual para evitar repetição não substitui a política efetiva nem autoriza liberar ações por similaridade. |
| aurora/core/metacognition.js, learning_signals.js, classification/experience.js, memory-consolidator/lib/engine.js | Metacognição grava METACOGNITION como fato; experiência registra resultados por ferramenta; consolidação possui configuração opt-in e sanitização. Separar telemetria de aprendizado sem apagar histórico. |
| `vendor/packages/logos/docs/architecture.md`, `src/stabilizer/index.ts`, `staging.ts`; buscas em `src/stabilizer` | Eventos de commit, estabilidade, falha e rollback carregam pacote e evidências parciais, mas não o vínculo completo com a tarefa e o conteúdo validado. O hash do contrato não representa o conteúdo inteiro do pacote. A implementação é uma ponte de compatibilidade em extração. |

A resolução local de logos/package.json aponta para /root/code/ThinkIac/packages/logos/package.json.
Isso identifica a dependência do checkout, não comprova qual build está em execução
no processo ativo. A documentação informa que mudanças no núcleo exigem build e
reinício; aprovação e impacto operacional serão tratados na etapa de ativação.

## Sequência de implementação

### 1. Fixar contratos e regressões antes de alterar o comportamento

Arquivos: testes de recibos, compilador, skills e integração de composição da Aurora;
testes do Stabilizer em packages/logos/tests.

Definir fixtures para tarefa, execução, operação, pacote, candidato e evento.
Reutilizar runId como vínculo inicial de execução. Quando um objetivo atravessar
execuções, definir um identificador de tarefa persistido e sua associação explícita
aos runs; nunca deduzir identidade apenas de sessão ou semelhança textual.

Cobrir duas sessões no mesmo pacote, dois pacotes na mesma tarefa, eventos atrasados,
reinício, mudança de objetivo na mesma sessão e escrita bloqueada antes de executar.
Registrar os testes atuais que mudam de semântica, especialmente o fallback global.

Aceite: falhas reproduzíveis para os novos requisitos e preservação das rotas,
tools, eventos, templates e formatos públicos atuais.

### 2. Vincular recibos ao candidato efetivamente validado

Arquivos: aurora/core/stability_receipts.js, aurora/hooks/index.js,
aurora/core/agent.js, engineer/index.js e Stabilizer.

Introduzir envelope versionado com receiptId, task/runId, operationIds, sessionId,
package, candidateId, candidateHash, timestamps, status, checks e checkpointRef.
Campos sem evidência ficam nulos; eventos legados continuam aceitos como não atribuídos.

Gerar a identidade do candidato no produtor da transação do Stabilizer. Definir
manifesto determinístico dos arquivos que participam da validação, incluindo
exclusões/tombstones e limites de arquivos gerados; documentar cobertura do hash.
Não usar o hash de capacidades ou um hash calculado depois da publicação como
prova do código avaliado. Detectar mudanças durante staging e invalidar ou reiniciar
a tentativa, evitando atribuir resultado a conteúdo que mudou durante o teste.

Propagar correlação das ferramentas que escrevem, confirmando caminhos e resultado.
Comandos shell e edições externas sem atribuição comprovada permanecem desconhecidos.
Uma transação pode agregar várias operações e autores; representar a pluralidade,
sem escolher automaticamente a sessão mais recente.

Preservar histórico por candidato. Uma leitura via shell ou ação negada não apaga
evidências. Eventos globais permanecem consultáveis, mas não viram ordens de reparo
na tarefa corrente. A expiração será metadado operacional, não mera frase no prompt.

Aceite: isolamento entre tarefas, persistência após reinício, eventos duplicados
idempotentes, hash divergente sem aceite, rollback com referência ao candidato
rejeitado e à versão restaurada. Não afirmar versão saudável se restaged for falso.

### 3. Expor estado da entrega por evidência

Arquivos: durable_runs.js, stability_receipts.js, agent.js e consumidores de estado
da Aurora, a localizar antes da alteração de interface.

Persistir uma projeção por tarefa/pacote/candidato: alteração local, validação local,
validação do Runtime, ativação, rejeição e reversão. Manter eixos separados quando
necessário: teste local aprovado pode coexistir com publicação rejeitada.
Incluir estado desconhecido ou não aplicável para documentos e fluxos sem reload.

Guardar referências verificáveis dos testes, do conteúdo testado e dos recibos.
Uma nova edição invalida a aplicabilidade da evidência anterior, sem apagá-la.
Só indicar ativação quando o produtor confirmar o estágio correspondente.

Aceite: reinício e retomada preservam estado; evento antigo não regride candidato
novo; exit code zero nunca equivale a publicação. Disponibilizar consulta estruturada
pelo contrato de tools existente, sem inventar rotas nesta fase de planejamento.

### 4. Consolidar autorização sem ampliar permissões

Arquivos: governance/service.js e lib/{engine,policy}.js,
aurora/core/{pending_permissions,governance_resume}.js e integração em agent.js.

Antes de editar, completar o rastreio dos consumidores de service.js e das rotas
de aprovação. Concentrar avaliação e retomada no serviço atual. Distinguir aprovação
de uma operação, autorização explícita de escopo e preferência de modo da sessão.

Representar autorizações de escopo apenas quando houver concessão identificável:
origem, alvos, efeitos permitidos, validade e revogação. Preservar aprovação consumível
de ação exata e impedir replay. Repetição de entrega de uma decisão não pode executar
a mesma mutação duas vezes. Mudança de alvo ou efeito requer nova avaliação.

Aceite: autorização já concedida é respeitada dentro dos limites; bloqueios e modos
manual/semi/auto continuam funcionando; a UI informa a razão e origem da exigência.
Não mudar o modo da sessão nem interpretar texto do plano como concessão de acesso.

### 5. Completar composição e seleção de contexto

Arquivos: context_compiler.js, agent.js, skills.js, prompts/README.md e parts.

Estender fragmentos existentes com condição de ativação, versão/origem e validade
dos dados operacionais. Separar parts para diagnóstico mantendo ordem e placeholders.
Usar expiração e substituição explícita para sessão, recibos e dados dinâmicos.

Preservar delimitadores ao resumir conteúdo externo. Definir mínimo obrigatório
para instruções e identidade da sessão; sob orçamento insuficiente, retornar
diagnóstico explícito em vez de remover silenciosamente contexto indispensável.

Localizar o produtor real do snapshot usado em agent.js antes de alterar seleção;
workspace.js trata raízes e navegação e não deve ser presumido como produtor do
inventário. Fornecer catálogo curto e ampliar detalhes por relevância e descoberta.
Validar sinal explícito de tarefa de desenvolvimento para Engineer, com fallback
limitado quando o classificador falhar, sem tornar a skill permanente novamente.

Aceite: compact/detailed/full e fallback preservam contratos; conteúdo externo não
escapa de sua marcação; contexto operacional antigo sai; fragmentos descartados
ficam explicáveis por metadados, sem registrar segredos ou prompts completos.

### 6. Separar memória útil de telemetria

Arquivos: metacognition.js, learning_signals.js, classification/experience.js,
memory-consolidator e caminho de appendFact/recuperação em aurora/memory/session.js.

Completar o rastreio dos leitores antes da migração. Classificar novos registros
em preferência, decisão, fato, aprendizado ou telemetria. Preservar métricas em seu
armazenamento operacional; promover apenas aprendizado reutilizável e fundamentado.
Aplicar deduplicação, origem e seleção por relevância na recuperação.

Tratar METACOGNITION legado por filtro ou classificação reversível, sem excluir
histórico. Preservar consultas de reflexões existentes e preferências explícitas.
Não ativar automaticamente a consolidação opt-in.

Aceite: ciclos triviais deixam de ocupar memória injetada; aprendizado relevante e
preferências continuam recuperáveis; ferramenta de memória indisponível não bloqueia
o trabalho; nenhuma limpeza destrutiva é necessária.

### 7. Completar erros e contratos verificáveis

Arquivos: tool_outcome.js, recovery_policy.js e adaptadores consumidores;
packages/logos/src/kernel/{package-contract,event-contracts}.ts e staging.ts.

Inspecionar consumidores restantes antes de mudar schema. Acrescentar, quando houver
evidência, ação necessária e vínculo com operação; preservar valor bruto e adaptação
legada. Evitar retries automáticos de mutações cujo resultado seja desconhecido.

Reutilizar a validação de contratos já executada pelo staging para comparar declarações
e capacidades carregadas. Expandir cenários de rotas, tools e eventos sem alterar
manifests de outros pacotes a partir de recibos alheios.

Aceite: erro de permissão, erro transitório e resultado incerto têm tratamento distinto;
consumidores legados seguem funcionando; capacidades declaradas e implementadas são
verificadas antes da ativação quando cobertas pelo contrato.

## Dependências e lotes

Lote A: etapas 1, 2 e 3. Resolve primeiro atribuição e conclusão verificável.
Lote B: etapa 5, usando os recibos versionados do lote A.
Lote C: etapa 4, após rastreio completo de autorização e retomada.
Lote D: etapas 6 e 7, que podem evoluir independentemente dos demais após os contratos.
Cada lote deve ter diff revisável, documentação atualizada e testes focados.

## Matriz final de aceite

| Cenário | Resultado esperado |
| --- | --- |
| Ajuste visual simples | Plano curto, validação visual pertinente, capacidades preservadas. |
| Bug funcional | Reprodução e regressão; teste ligado ao conteúdo corrigido. |
| Mudança estrutural | Contratos, migração e recuperação documentados. |
| Autorização já concedida | Prossegue no escopo, sem repetição da confirmação. |
| Recibo de outra tarefa | Não orienta reparo nem comprova a entrega atual. |
| Edições concorrentes no mesmo pacote | Autoria explícita ou desconhecida, nunca presumida pelo horário. |
| Ferramenta indisponível | Limitação honesta e alternativa válida quando houver. |
| Eventos fora de ordem ou após reinício | Projeção consistente e sem execução duplicada. |
| Contexto acima do orçamento | Dados opcionais reduzidos com diagnóstico, contratos essenciais preservados. |
| Telemetria repetida | Continua operacional, sem virar instrução durável. |

Testes determinísticos validam composição e estados. Avaliação do comportamento do
modelo deve usar cenários separados, registrar configuração e resultados observados,
e não ser apresentada como garantia apenas porque o template renderiza.

## Validação já executada e ativação futura

25 testes passaram com node --test: aurora/core/stability_receipts.test.js,
aurora/core/context_compiler.test.js, aurora/core/tool_outcome.test.js,
aurora/test/skills_inflect.test.js e engineer/test/tool_schema.test.mjs.
Esses testes validam a base atual, não as funcionalidades propostas.

Não houve publicação nem validação ao vivo do Runtime nesta tarefa. Este plano é
o único arquivo criado. A ferramenta create_artifact não está disponível nesta
sessão; a entrega usa um documento local persistente.

Na implementação, migrar armazenamento com versão e leitura legada, preservar cópia
recuperável e liberar por lote. Validar primeiro em ambiente isolado. Para mudanças
no núcleo, verificar o build realmente carregado e o impacto do reinício antes da
ativação. Reverter flags/código e projeções de forma compatível, preservando o
histórico de recibos e autorizações. Encerrar cada lote distinguindo alteração local,
testes executados e aceite/ativação comprovados.

## Continuação: projeção e consulta de entregas

A projeção em `aurora/core/stability_receipts.js` agora inclui alterações locais,
checks vinculados ao hash do arquivo e aplicabilidade da última edição registrada.
O hash do arquivo não é tratado como hash do pacote. Uma evidência local nunca
comprova ativação. As projeções do Runtime preservam hashes distintos e indicam
`identity_conflict` quando um ID de candidato aparece com conteúdos divergentes.
O prompt usa os recibos atuais por candidato, evitando apresentar uma aceitação
antiga como estado atual depois de rollback.

A tool `getDeliveryStatus` em `aurora/index.js` expõe a consulta estruturada,
exigindo sessão e execução ou tarefa. O registro no Runtime ativo ainda precisa
ser confirmado. O armazenamento e as tools anteriores foram preservados.

Validação desta continuação: suíte Node focada com 59 testes aprovados; após a
conciliação de alterações simultâneas, a suíte de recibos passou com 12 testes
(inclui os testes de recibos da rodada anterior). No Logos, 19 testes passaram
em candidate, staging-authority, package-contract e event-contracts. Sintaxe do
index da Aurora verificada. Isso não comprova aceite nem ativação em produção.

O plano completo ainda requer fechar a matriz de aceite, em especial autorização
persistida de escopo, metadados individuais dos prompt parts, recuperação de
correlação após reinício e validação integrada de publicação. As seções anteriores
que descrevem ausência de implementação registram o diagnóstico original.


## Continuação: composição auditável dos prompt parts

Implementados metadados individuais dos sete parts: finalidade, origem, hash do
conteúdo usado, nível de ativação e validade por composição. O carregador mantém
conteúdo e ordem de compact/detailed/full, incluindo o fallback integral existente.
`agent.js` inclui essas fontes no input trace sem persistir o texto dos prompts.
O trace registra também motivos de descarte e diagnóstico de orçamento insuficiente.
Skills descartadas por orçamento deixam de constar como fontes utilizadas.

A regra explícita de desenvolvimento já existente agora tem proveniência própria
(`explicit_development`). A telemetria distingue falha do classificador da seleção
efetiva do Engineer, preservando seleção comum, cache e renderização dinâmica.
Testes exercitam falha do classificador e mensagem sem relação com desenvolvimento.
A regra continua limitada a ação e assunto explícitos; retomadas como “continue”
ainda dependem da associação de tarefa e não são tratadas como nova autorização.

Validação: 43 testes Node aprovados nas suítes de prompt parts, input trace, skills,
compilador, recibos, tool outcomes e schema do Engineer. `node --check` aprovou
`aurora/core/agent.js`. Nenhum build, reinício ou aceite do Runtime foi comprovado.

Permanecem pendentes: correlação persistida no produtor após reinício, associação
explícita entre tarefas e runs, autorizações de escopo, classificação completa da
memória, catálogo por relevância e fechamento dos cenários integrados de contratos
e publicação. Esta continuação fecha os metadados dos parts, não o plano inteiro.
