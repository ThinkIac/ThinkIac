# Supervisor do Lógos

`@logos/supervisor` fornece supervisão externa de serviços e um
adaptador de ciclo de vida para pacotes do Lógos. Linux, Node >=20 e `flock`
(util-linux) são necessários. Não depende de PM2. Versão 0.1.0 publicada no registry
`https://npm.thinkiac.cloud` em 2026-09-10.

## Operação

Na raiz do workspace:

```sh
logos supervisor validate
logos supervisor start Agent
logos supervisor status
logos supervisor logs Agent
logos supervisor pid Agent
logos supervisor restart Agent
logos supervisor stop Agent
logos supervisor shutdown
```

`--root /caminho/do/workspace` seleciona outro workspace. `run` executa em
foreground; `start` sem alvo inicia o daemon com as intenções persistidas.
`shutdown` encerra o daemon e seus serviços, preservando a intenção para o
próximo boot. `stop ALVO` grava intenção de parada antes de enviar o sinal.
`start ALVO` limpa o orçamento de falhas e solicita nova execução.
A resposta de start/restart confirma a solicitação, não prontidão. Consulte
`status` até `health: ready` para serviços com handshake IPC. Consumidores Node
podem usar `waitForReady(root, alvo, timeoutMs)` para obter um recibo de
prontidão sem presumir que o pedido de reinício foi bem-sucedido.

`npm start` do monorepo passa pela extensão `logos supervisor start Agent`.
Billing está declarado, mas não inicia automaticamente. A configuração está em
`logos.supervisor.json`, versão 1, com serviços identificados por nome.

## Configuração e estados

Cada serviço declara `command`, `args`, `cwd`, `autostart`, `dependsOn`, `ready`
e `policy`. `env` é opcional; não coloque credenciais em arquivos versionados.
Os filhos recebem o ambiente do supervisor, acrescido do ambiente do serviço.
Mudanças de configuração/ambiente são lidas no próximo início do daemon.

Políticas: `restart` (`always`, `on-failure`, `never`), `maxRestarts`, `windowMs`,
`minUptimeMs`, `delayMs`, `maxDelayMs`, `stopTimeoutMs`, `bootTimeoutMs`,
`heartbeatMs`. Intervalos são milissegundos. A espera é exponencial, com teto.
O orçamento de reinícios é por execução do daemon, não cumulativo após reboot.

Estado desejado: `running` ou `stopped`. Observado: `starting`, `running`,
`backoff`, `blocked`, `stopping`, `stopped` ou `failed`. Saúde é separada:
`unknown`, `ready` ou `unhealthy`. `ready: process` confirma apenas criação do
processo e mantém saúde desconhecida. `ready: ipc` exige
`process.send({type:'logos:ready'})`; heartbeat usa `logos:heartbeat`.
`notifyReady()` envia ambos, com heartbeat a cada segundo.

Dependências iniciam antes dos consumidores. Dependência parada bloqueia o
início do consumidor. Uma dependência que cai após a ativação não derruba
consumidores já ativos. Parar um provedor exige parar seus consumidores antes.

## Lógos, Isolated e Gerenciador de Tarefas

O bootstrap aceita módulos explicitamente compostos em `modules`. Use
`createRuntimeModule({ recoverIsolatedPackage })` de `runtime.cjs`, passando a
função pública exportada pelo Lógos. Essa composição é confiável, equivalente
aos módulos internos; não é um caminho de instalação de código não confiável.

O adaptador observa saídas Isolated e recupera pelo staging normal, preservando
permissões, rotas, tools e hooks. Operações de recuperação/start/stop compartilham
a fila do pacote. Candidatos inválidos preservam o filho saudável. Chamadas IPC
interrompidas falham; não são reenviadas automaticamente.

`runtime.supervision` no manifesto do pacote configura a política. `proc`
delega o reinício ao adaptador quando presente e conserva a política anterior
quando ausente. Seu estado após spawn é saúde desconhecida, pois o protocolo
legado não oferece handshake de prontidão. Heartbeat do supervisor externo não
é heartbeat individual dos pacotes Isolated/proc.

O Gerenciador existente mantém funções anteriores e acrescenta serviços,
reinícios, PID, saúde, logs e comandos. Os endpoints externos exigem administrador
sem delegação. Parar/reiniciar o próprio Runtime consulta a proteção de sessões
antes de agendar a ação. Sem Runtime disponível, use a CLI.

## Persistência, logs e exclusividade

`.logos/supervisor` contém socket privado (0600), estado gravado atomicamente,
registros de propriedade e logs. O diretório exige proprietário atual e modo
0700. Estado inválido impede boot: restaure uma cópia válida, não descarte a
intenção silenciosamente. A persistência dos pacotes fica no diretório equivalente
dentro do workspace de pacotes passado ao bootstrap.

O daemon mantém `flock`. Um guardian por serviço encerra seu grupo de processos
se perder a conexão com o daemon, escalando SIGTERM para SIGKILL. Recuperação de
órfãos verifica PID, instante de nascimento e ID de boot. Processos que escapem
do grupo criando outra sessão precisam de cgroup do ambiente para contenção.

Logs têm três arquivos de até 1 MiB por serviço, leitura de até 64 KiB, mensagens
de até 32 KiB e fila IPC limitada. Sob sobrecarga, saída pode ser descartada.
Erro de escrita aparece como `logError` e não causa cascata de reinícios.
Logs de aplicações podem conter dados sensíveis; o supervisor não faz redação
automática. Snapshot não inclui ambiente. RSS é do processo principal do serviço,
não dos descendentes nem atribuído a cada pacote no mesmo processo.

## Inicialização após reboot

`logos supervisor systemd` gera uma unidade revisável com caminhos absolutos,
`Restart=on-failure`, `KillMode=control-group` e `UMask=0077`. A entrada systemd é
Node (`systemd-entry.cjs`), sem launcher Python e sem dependência de PM2. Instale como serviço
do usuário operacional; configure o ambiente necessário e habilite pelo mecanismo
systemd desse host. O módulo gera o arquivo, não instala nem habilita serviços.
Revise `TimeoutStopSec` para a soma dos prazos dos serviços.

Em contêiner use `run` em foreground, `flock` disponível e política de reinício do
contêiner. Imagens existentes que executam diretamente o Runtime podem continuar
com Docker como proprietário; não sobreponha dois supervisores ao mesmo alvo.
Reboot real do host e build das imagens não foram executados nesta entrega.

## Migração dos usos PM2

| Uso local | Equivalente | Evidência |
| --- | --- | --- |
| Start Agent | `logos supervisor start Agent` | CLI compilada e configuração validadas |
| Serviço billing separado | configuração, autostart false | configuração validada; sem iniciar billing |
| Stop/start/PID em cleanup-tenants.sh | CLI supervisor | sintaxe bash; script destrutivo não executado |
| Reboot Runtime | saída recuperada pela política always | testes com processos; sem reiniciar produção |
| Proteção Engineer | inclui comandos supervisor | regra preserva bloqueio PM2 legado |
| Diagnóstico e controle | CLI e process-manager | testes locais e navegador com HTTP simulado |
| Startup após reboot | `logos-thinkiac.service` | unidade habilitada e Agent sob o Supervisor |

O corte operacional foi concluído no host de destino em 2026-09-10. A unidade
`pm2-root.service`, o pacote global PM2, seus daemons e estados foram removidos;
o antigo `gabriel-panel` também foi aposentado. A Agent é propriedade exclusiva
de `logos-thinkiac.service`. Em instalações futuras, inventarie por serviço cwd,
comando, usuário, ambiente necessário e prontidão antes de cortar, sem exportar
segredos.

O detector de conflito bloqueia scripts Node já ativos com mesmo cwd/entrypoint,
inclusive o título comum de PM2. Não é detecção universal de comandos externos;
o inventário continua necessário. Não alegar substituição operacional completa
antes de ensaiar reboot, corte e retorno no ambiente de destino.

## Testes

```sh
npm run test:supervisor
npm --workspace logos test -- tests/supervisor.test.ts tests/isolated-runner.test.ts tests/isolation.test.ts tests/lifecycle.test.ts tests/staging-authority.test.ts
node --test apps/thinkiac/packages/process-manager/test/recovery.test.js
node apps/thinkiac/packages/process-manager/test/browser-supervisor.mjs
npm --workspace logos run build
```

Fixtures usam processos e diretórios temporários: crash, budget, parada
persistente, timeout de boot/heartbeat, concorrência, exclusividade, descendentes,
queda do daemon e dependências paradas. Navegador usa HTTP simulado, não comprova
autorização nem aceitação de uma versão no Runtime ativo.

## Corte operacional de 2026-09-10

Versão 0.1.0 publicada e conferida no registry. Build do Lógos aprovado.
A unidade `logos-thinkiac.service` executa o supervisor deste workspace;
`logos-migration-verify.service` verifica prontidão IPC e HTTP após o reboot.
O corte é executado fora da árvore da Agent, pois encerrá-la também interrompe
a sessão do agente. O procedimento testa recuperação após SIGKILL antes do
reboot e aguarda a Agent voltar pelo Supervisor se a verificação falhar.

O resultado efetivo fica em [MIGRATION-RESULT.json](./MIGRATION-RESULT.json).
Consulte o campo `stage`: `reboot-validated` confirma a verificação após reboot;
`rolled-back` ou `rollback-failed` indicam falha. Agendamento não comprova sucesso.

Configuração anterior e ambiente estão preservados com acesso restrito em
`/root/.local/state/logos-migration`. O serviço billing do supervisor permanece
parado. Qualquer reinício futuro exige o aviso e a confirmação explícita
descritos abaixo.

## Regra de reset

O pacote `reboot` não usa mais `process.exit()` como mecanismo de recuperação.
Ele exige `confirm: true`, registra o motivo e solicita `restart` ao supervisor
externo. Se o supervisor não estiver presente ou rejeitar a solicitação, a
Agent continua em execução. O chamador deve apresentar o impacto antes de
enviar a confirmação; o pedido aceito ainda só é concluído quando o supervisor
voltar a reportar `health: ready`.
