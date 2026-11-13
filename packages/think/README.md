# Think

`think` é a fachada mínima para publicar eventos no Runtime. Este README é o
mapa para quem cria um pacote que precisa aparecer na interface do ThinkIac ou
persistir dados. Os contratos de cada host ficam nos pacotes responsáveis; os
links abaixo são a fonte de verdade.

## Mapa de integrações

| Quero declarar | Declaração no `package.json` | Host responsável | Exemplo ativo | Referência |
| --- | --- | --- | --- | --- |
| Item de menu | `manifest.menu` | Shell | [`pkgmgr`](../pkgmgr/package.json) | [Shell](../shell/README.md#menu) |
| Bloco no chat / `MessageList` | `manifest.widget` | Shell e Agent | [`terminal`](../terminal/package.json) | [Widgets do Agent](../agent/docs/package-widgets-and-ui-bus.md) |
| Aba administrativa | `manifest.settingsTab` | Settings | [`specialists`](../specialists/package.json) | [Settings](../settings/README.md#aba-administrativa) |
| Credenciais de integração | `manifest.keysTab` | Settings | pacote com integração | [Integrações](../settings/README.md#integrações-e-credenciais) |
| Formulário declarativo | `renderer: "schema"` e `surface` na aba | Settings + `ui-schema` | [`auth`](../auth/package.json) | [ui-schema](../ui-schema/README.md) |
| Confirmação, alerta ou prompt em uma view | importação do componente | `ui-dialogs` | [contrato do `ui-dialogs`](../ui-dialogs/AGENT.md) | [Diálogos](../ui-dialogs/AGENT.md) |
| Ícone do pacote ou do menu | `icon`, `iconDark`, `iconPreset`, `menu.icon` | Shell | [`openai-bridge`](../openai-bridge/package.json) | [Ícones do Shell](../shell/README.md#ícones-do-manifesto) |
| Dados próprios | `schema.prisma` | Lógos | [contrato Lógos](../../vendor/packages/logos/docs/package-integrations.md#banco-e-isolamento) | [Banco e isolamento](#banco-e-isolamento) |

Lógos descobre `package.json`, mas os campos de interface acima são
interpretados pelos hosts indicados, não pelo kernel. O contrato de pacote do
Lógos permanece a referência para `runtime`, dependências e dados.

## Menu, widget e MessageList

`manifest.menu` coloca uma entrada compacta no Shell. O objeto escolhe a view
local e sua posição; ele não cria um widget no chat.

`manifest.widget` declara uma linguagem de bloco Markdown que o `MessageList`
do Shell/Agent pode renderizar numa view isolada. Uma declaração típica é:

```json
{
  "manifest": {
    "widget": {
      "lang": "bash",
      "title": "Terminal",
      "view": "Widget",
      "aliases": ["shell", "sh"]
    }
  }
}
```

Para altura, mensagens parciais e comunicação com a view, siga o contrato de
[widgets e UI bus](../agent/docs/package-widgets-and-ui-bus.md).
O widget é uma contribuição de mensagem, não uma permissão para executar código
na mensagem.

## Settings, integrações e superfícies declarativas

Use `settingsTab` para configuração administrativa e `keysTab` para
credenciais de uma integração. Cada uma aceita objeto ou lista. `iframe` é o
renderer padrão; `schema` exige uma `surface` válida. `systemTab` existe só por
compatibilidade e não deve ser usado em pacotes novos.

`ui-schema` descreve estado e ações fechadas para o Settings renderizar. A
surface declara `version`, `kind` e `actions`; o pacote continua responsável
por autenticar, autorizar e validar toda ação de leitura ou escrita. Use uma
view Svelte em iframe quando o fluxo não for declarativo.

O componente disponível para interações pontuais é `ui-dialogs` (não há um
pacote `ui-modal` neste repositório). Ele cobre `confirm`, `prompt` e `alert`
em views executadas em iframe.

## Ícones do manifesto

O Shell aplica os ícones nesta precedência:

1. `manifest.menu.icon` e `menu.iconDark` valem apenas para o menu.
2. Sem ícone próprio de menu, ele herda `manifest.icon` e `iconDark`.
3. `manifest.iconPreset` aponta para o catálogo do Shell, por exemplo
   `{ "pack": "lucide", "name": "Terminal" }`.
4. Sem uma variante aplicável, o renderer usa seu fallback visual.

`icon` e `iconDark` são caminhos de recursos do pacote. `iconPreset` seleciona
um ícone do catálogo. Escolha uma fonte por contexto: o ícone do menu substitui
o ícone geral só naquele item, sem composição automática.

## Banco e isolamento

Um `schema.prisma` cria um tenant e diretório de banco por pacote. O acesso
normal usa `ctx.db.self()` em código atribuído ao pacote ou `getProxy('<pacote>')`
nos contratos legados.

Para dados exclusivos do dono, declare ambos os campos de topo:

```json
{
  "isolated": true,
  "database": "private"
}
```

Esse modo executa o pacote no runner filho isolado e cria um tenant privado
cifrado em repouso pelo vault SQLCipher. Outro pacote não obtém esse banco com
`getProxy`; dados devem sair por tool, rota ou evento do próprio dono. As
garantias, fontes de chave e limites operacionais estão em
[Banco e isolamento no Lógos](../../vendor/packages/logos/docs/package-integrations.md#banco-e-isolamento).

`runtime.isolation.critical` trata outro problema: impede que uma reinicialização
global silenciosa derrube estado crítico. A recarga e o rollback de um pacote
são isolados; em alterações de `schema.prisma`, código e banco são restaurados
juntos. Consulte [isolamento e Stabilizer](../../vendor/packages/logos/docs/package-integrations.md#recarga-e-estado-crítico).

## Referência rápida

- [Pacotes, banco e isolamento no Lógos](../../vendor/packages/logos/docs/package-integrations.md)
- [Shell](../shell/README.md)
- [Settings](../settings/README.md)
- [ui-schema](../ui-schema/README.md)
- [ui-dialogs](../ui-dialogs/AGENT.md)
