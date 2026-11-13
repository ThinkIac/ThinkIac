# ui-dialogs — confirm/prompt/alert para views em iframe

## O bug que originou isto

As views de pacote rodam dentro de um iframe (ver `views/lib/theme.js` em
qualquer pacote). **Iframe sem a flag `allow-modals` bloqueia
`window.confirm()`/`alert()`/`prompt()` silenciosamente**: a chamada retorna na
hora — `confirm()` devolve `false`, `prompt()` devolve `null` — sem exibir nada
e sem erro no console.

O sintoma é o pior possível para depurar: **o botão simplesmente "não faz
nada"**. Foi isso que deixou Publicar/Descartar/Remover do wordpress-builder
aparentemente travados.

Pior ainda: como `confirm()` devolve `false`, o código lê isso como "o usuário
cancelou" e segue como se nada tivesse acontecido. Nenhum log, nenhuma exceção.

## Uso

```svelte
<script>
  import Dialogs, { askConfirm, askPrompt, askAlert }
    from '../../ui-dialogs/views/components/Dialogs.svelte';

  async function remover(lista) {
    if (!await askConfirm(`Remover "${lista.nome}"?`, { danger: true })) return;
    // ...
  }
</script>

<!-- uma vez por view, costuma ficar antes do <style> -->
<Dialogs />
```

As funções vêm do `context="module"`, então qualquer função da view chama
direto — sem prop drilling. O componente só precisa estar montado.

| Função | Resolve para | Equivalente nativo |
|--------|--------------|--------------------|
| `askConfirm(msg, opts?)` | `true` / `false` | `confirm()` |
| `askPrompt(msg, default?, opts?)` | a string, ou `null` se cancelado | `prompt()` |
| `askAlert(msg, opts?)` | quando fechado | `alert()` |

Opções: `title`, `confirmLabel`, `cancelLabel`, `danger` (botão vermelho),
`placeholder` e `selectOnly` (texto só de leitura, pré-selecionado — para o
caso "mostre isto para eu copiar").

## Detalhes que importam

- **Fila, não estado único.** Uma confirmação disparada enquanto outra está
  aberta entra na fila em vez de sobrescrever a primeira. Com estado único a
  Promise da primeira nunca resolveria e o fluxo dela ficaria pendurado para
  sempre — tem teste para isso.
- **`askPrompt` cancelado devolve `null`**, igual ao nativo, para a conversão
  ser mecânica: quem já tratava `null` continua correto.
- **Esc cancela, Enter confirma.**
- Estiliza com as variáveis `--tk-*` das views embedadas, então acompanha o
  tema do pacote sem configuração.
- O componente vive em `views/components/` e **não** na raiz de `views/`: o
  registro de apps (`aura-system/apps/index.js`) transforma todo `.svelte` na
  raiz de `views/` num app, e um componente não deve virar app.

## Já convertidos

`auth` (5), `lista-de-compra` (5), `elm-studio` (3), `config` (3), `claude` (1),
`maritaca` (1, o fallback de cópia).

O `wordpress-builder` foi corrigido antes disto, com um modal próprio local —
foi ele que serviu de referência visual.

**Não converter:** os `prompt()`/`alert()` dentro da string `BOOKMARKLET` do
`maritaca` rodam na página da Maritaca, no navegador do usuário, e não neste
iframe. Lá o nativo é o certo.

As views do próprio Aurora (`packages/agent/views/`) são a página host, não
iframe — `confirm()` funciona nelas e não estão no escopo deste bug.

## Testes

```
node packages/ui-dialogs/test/dialogs.test.js
```

8 testes: compila o componente de verdade e monta num DOM (jsdom), então o que
é verificado é o contrato que as views usam.
