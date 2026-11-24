# Migração para a composição modular

A estrutura atual separa o launcher Lógos, o host ThinkIac e os módulos de
capacidade. A independência de boot e distribuição possui um teste dedicado;
a migração de todos os consumidores legados para snapshots nativos continua
sendo uma etapa distinta. Este documento descreve o código local, não uma
versão publicada ou aceita pelo Runtime.

## Responsabilidades que mudaram

| Antes, no runtime agregado | Responsável atual |
| --- | --- |
| Express, servidor, staging de rotas | `http` |
| Hub e transporte WebSocket | `websocket-runtime`, biblioteca `websocket` |
| Compilação, aquecimento e entrega de views | `svelte` |
| Banco, composição de schema e vault privado | `db` |
| Watch, candidatos, checkpoints e recuperação | `stabilizer` |
| Threads de CPU | `workers` |
| Processos isolados e IPC | `isolated-runtime` |
| Vocabulário e scanners concretos | `annotations` |
| Portas das fábricas antigas | `runtime-compat` |

Veja o [mapa completo](docs/architecture.md#resource-owners). Os caminhos antigos
em `logos/src/modules`, `stabilizer`, `database` e `core/isolated` incluem contratos
e fachadas para implementações externas. Sua presença não instala outra cópia.

## Migrar o host

1. Declare no projeto as dependências dos módulos e suas bibliotecas.
2. Passe uma lista explícita em `externalModules`. Use `[]` para nenhuma
   capacidade externa, sem esquecer os provedores declarados no workspace.
3. Preserve as configurações de capacidades exigidas pela sua aplicação.
   Configuração sozinha não seleciona módulo.
4. Confira `requires` e fases antes do boot. O catálogo inteiro é validado e
   selado antes da primeira instalação.
5. Use a instância retornada e encerre com `await runtime.close()`.

Nomes npm e caminhos explícitos permitem composição fora do layout vendor.
Aliases antigos como `http` ainda resolvem capacidades externas, inclusive quando
o nome coincide com um built-in do Node. Descoberta adjacente permanece como
compatibilidade quando a lista não é informada.

## Migrar um módulo

Prefira funções comuns com `@register module` e `@register type`, sem API de
registro importada do Lógos. Um mesmo pacote pode fornecer e consumir recursos,
em qualquer profundidade do workspace. `runtime.role` não é necessário. Veja
[workspace.md](docs/workspace.md) para contratos e exemplos executáveis.

Declare `requires` para dependências obrigatórias e `after` para ordenação
opcional. Registre tudo na janela inicial: adicionar ou substituir módulos após
o selo exige outro boot, mesmo quando existe `swappable`. Pacotes comuns podem
ser ativados depois; isso não reabre o catálogo de módulos.

Para recursos recarregáveis, implemente `resources[type].prepare(snapshot, ctx)`
e retorne `commit`, `rollback` e `dispose`. A função simples de consumo e os
listeners antigos continuam válidos, mas seus efeitos não ganham transação
implicitamente. Consulte o [protocolo](docs/modules.md).

## Compatibilidade preservada

- `bootstrap()` e os exports soltos continuam disponíveis. Os exports usam o
  container padrão, definido pelo boot mais recente.
- Fábricas `createRuntimeModule(host)` usam `runtime-compat`, fornecido pelo
  módulo ou resolvido como capacidade externa.
- `@register_module` e demais aliases legados continuam suportados.
- Exports de classes e compilador carregam a implementação externa sob demanda.
  Chamá-los requer que o módulo correspondente esteja disponível.
- `atomic` e `docker` são aceitos com aviso e ignorados.

Não remova imports, aliases ou fachadas enquanto houver consumidores. Migre e
valide a capacidade no módulo responsável. Testes antigos no pacote Lógos
continuam servindo como cobertura de compatibilidade.

## Aceite da migração

Execute build, testes de protocolo/independência/transações, distribuição isolada
e testes das capacidades selecionadas. Valide também a composição ThinkIac no
ambiente de destino. Um teste local aprovado não é recibo de aceite do Runtime.
Veja [testing.md](docs/testing.md) para comandos e limites.
