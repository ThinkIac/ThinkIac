# ThinkIac Shell

Interface principal do ThinkIac, visualmente derivada da experiência consolidada
na Aurora, mas sem pertencer a um agente.

O Shell é responsável por navegação, sessões, abas, aplicativos, canvas, tema,
mobile e composição da InputBar. A execução de IA passa por adapters em
`views/agents/`; trocar o agente da sessão não troca a aplicação.

Componentes do Shell não conhecem rotas, transporte ou chaves privadas de um
agente. Cada adapter implementa HTTP, recursos, streaming e capacidades; o
catálogo contém apenas metadados exibíveis pela interface.

## Estado atual

- Aurora: adapter funcional, usando o runtime existente.
- Scriba: listado como indisponível até expor loop, sessões e transporte.
- Seleção: persistida por sessão em `localStorage`.

## Acesso

`/view/shell/Index`

## Ações contextuais no cabeçalho

Um pacote pode declarar ações para o dropdown do cabeçalho de qualquer view,
inclusive a view de outro pacote. A declaração fica no `manifest` do
`package.json`:

```json
{
  "headerActions": [{
    "id": "edit-with-ai",
    "label": "Editar com IA",
    "description": "Abre o assistente sobre este projeto",
    "target": { "package": "projects", "view": "Editor" },
    "event": "ai:edit-project",
    "order": 20
  }]
}
```

Ao clicar, o Shell envia ao iframe da view alvo um `postMessage` de origem do
mesmo Runtime: `{ type: "thinkiac:header-action", version: 1, action, target }`.
A view alvo deve escutar o evento e validar `event.origin` antes de agir. O
manifest não executa código, não aceita URL arbitrária e não transporta payload
livre; a ação é apenas uma intenção nomeada que o pacote alvo escolhe suportar.

## Menu

O Shell interpreta `manifest.menu` como uma contribuição compacta. A entrada
deve apontar para uma view local dedicada, diferente de `Index` e `Home`:

```json
{
  "manifest": {
    "menu": {
      "id": "my-package",
      "label": "Meu pacote",
      "target": "left",
      "view": "Widget",
      "order": 100,
      "hidden": true
    }
  }
}
```

`target` aceita `left` ou `right`; sem valor, usa `left`. `hidden` define só a
visibilidade inicial, pois a escolha posterior do usuário prevalece. Veja o
[mapa central](../think/README.md#mapa-de-integrações).

## Ícones do manifesto

1. `manifest.menu.icon` e `menu.iconDark` valem somente para o menu.
2. Sem ícone próprio, o menu herda `manifest.icon` e `iconDark`.
3. `manifest.iconPreset` seleciona um ícone do catálogo, por exemplo
   `{ "pack": "lucide", "name": "Terminal" }`.
4. Sem variante aplicável, o renderer usa seu fallback visual.

`icon` e `iconDark` são caminhos de recursos do pacote. `color` e `bgColor`
devem ser cores CSS válidas, não classes Tailwind.

## Widget no chat

`manifest.widget` registra uma linguagem de bloco Markdown que o `MessageList`
renderiza numa view isolada; ele não cria item de menu. Veja o contrato de
[widgets e UI bus](../agent/docs/package-widgets-and-ui-bus.md).
