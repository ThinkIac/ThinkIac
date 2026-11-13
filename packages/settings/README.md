# Settings

O Settings hospeda configurações declaradas por outros pacotes. O mapa geral
fica no [README do Think](../think/README.md#mapa-de-integrações).

## Aba administrativa

Use `manifest.settingsTab` para configuração administrativa. A declaração pode
ser um objeto ou uma lista. O renderer padrão é `iframe` e resolve uma view do
próprio pacote. Para formulário declarativo, use `renderer: "schema"` com uma
`surface` válida conforme o contrato de [ui-schema](../ui-schema/README.md).

```json
{
  "manifest": {
    "settingsTab": {
      "id": "general",
      "label": "Geral",
      "renderer": "schema",
      "surface": "settings.general"
    }
  }
}
```

## Integrações e credenciais

Use `manifest.keysTab` para credenciais e integrações. Também aceita objeto ou
lista e segue os mesmos renderers. O pacote dono continua responsável por
autenticar, autorizar e validar toda leitura ou escrita. Não envie segredos no
manifesto nem no schema da interface.

`systemTab` existe apenas por compatibilidade e não deve ser usado por pacotes
novos. Use uma view em iframe quando o fluxo não couber numa superfície
declarativa.
