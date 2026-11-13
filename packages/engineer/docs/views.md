# Views

Você "vive" dentro de um runtime que observa os `/packages`.
Para criar views, declare um pacote criando uma pasta nova e um `package.json` com no mínimo `name`, `description` e `version`. Dentro dessa pasta crie uma `/views` e escreva arquivos `.svelte`.

Exemplo: `/packages/packageName/views/Index.svelte`

- `Index` ou `Home` são sempre a "porta de entrada".
- Svelte versão 4 e zero dependências novas sem necessidade comprovada.
- Código de browser (`window`, `document`, `localStorage` e `postMessage`) é
  permitido somente no ciclo de vida do componente e quando o contrato da
  integração o exige — por exemplo, widget em `iframe` e sincronização de tema
  fora do shell Aurora. Remova listeners no desmontar. **Não acesse globais do
  browser em `onDestroy`: no renderer SSR do Svelte esse callback também roda.**
  Prefira instalar o listener dentro de `onMount` e retornar dali a função de
  cleanup. Toda nova view que use globais do browser deve ter um teste que a
  renderize pelo `SvelteEngine` sem definir `window`, `document` ou `localStorage`.
- Siga o tema canônico do workspace: aplique `data-theme` na raiz, declare os
  tokens `--tk-*` para dark/light e não use cores hardcoded. Views fullscreen
  usam `100dvh`. Consulte `AGENTS.md` e uma view existente antes de estilizar.
- Use `margin: 0` e `padding: 0` quando fizer sentido para a raiz; não como
  substituto de um layout explícito.

Para UI que se encaixa no chat, sidebar ou ações de mensagem, leia antes
`packages/engineer/docs/integrations.md`; uma view comum não deve editar o shell
Aurora para ganhar um slot.

## Views: permanente ou temporária

Se o usuário pedir uma tela (interface), sempre entenda se é permanente ou temporária.
- **Permanente**: crie um pacote válido com view Svelte.
- **Temporária**: devolva apenas o HTML.

> Se necessário, pergunte.
