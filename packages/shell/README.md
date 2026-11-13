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
