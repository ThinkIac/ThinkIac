# Lógos

Lógos é o launcher e o protocolo de composição do ThinkIac. O kernel coordena
catálogo, dependências, declarações, autoridade e ciclo de vida. Recursos concretos
são fornecidos pelos módulos selecionados pelo host.

O pacote inclui o compilador de [LógosType](docs/logos-type.md) para arquivos
`.type` com CoffeeScript 2. Capacidades concretas não são dependências do launcher.
A distribuição empacotada pode iniciar sem HTTP, banco, Svelte, workers,
estabilizador ou diretório de módulos adjacente. Há fachadas de compatibilidade;
isso não significa que todos os consumidores já usem snapshots transacionais.

## LógosType nativo

Arquivos `.type` aceitam `module`/`type` como aliases, assinaturas tipadas,
diretivas no início do corpo e exports automáticos. Blocos `###` com `@register`
continuam aceitos. Modelos `.scriba`/`.schema` fornecem tipos e descrições de campos,
como `ID: User.ID`; o módulo de persistência fornece `User[ID]`. Veja [instalação, fluxo e exemplos](docs/logos-type.md).

## Começar sem capacidades

```js
const { bootstrap } = require('logos');

async function main() {
  const runtime = await bootstrap({
    workspace: '/caminho/absoluto/packages',
    externalModules: [],
    modules: [],
  });
  try {
    console.log(runtime.workspace); // app/server/stabilizer/mcp/workers são null
  } finally {
    await runtime.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
```

`externalModules: []` desativa a descoberta de capacidades adjacentes. O workspace
continua sendo descoberto, inclusive seus módulos e tipos. Para um boot realmente
vazio, use um workspace vazio. Omitir `externalModules` mantém a descoberta legada.
Configurar `http`, `views` ou `workers` não instala seus provedores.

## Pacotes, módulos e tipos

Qualquer pacote do workspace pode fornecer e consumir recursos. A descoberta
percorre subpastas, inclusive `packages/abc/b/pacoteReal/package.json` e filhos
de outros pacotes. A pasta `modules` não tem significado especial.

```js
// index.cjs de um pacote com package.json
exports.lifecycle = function lifecycle(context) {
  /** @register module arithmetic */
  return { install() { context.log('pronto'); } };
};

exports.accept = function accept(resource, context) {
  /**
   * @register type arithmetic
   * @requires arithmetic
   */
  context.state.set(resource.declaration.name, resource.handler);
};

exports.double = function double(value) {
  /** @register arithmetic double */
  return value * 2;
};
```

Não há import de API do Lógos nem export especial de registro. Um consumidor
pode ficar em outro pacote, em qualquer profundidade. Nomes de manifest
repetidos falham; arquivos de um pacote filho não são registrados pelo pai.

O [guia de workspace](docs/workspace.md) documenta contexto, tipos transacionais,
exemplos completos, migração e limites de recarga. Aliases antigos permanecem
para consumidores existentes; os entrypoints da distribuição usam declarações.

## Referências

| Documento | Conteúdo |
| --- | --- |
| [Workspace unificado](docs/workspace.md) | Pacotes aninhados, módulos e tipos declarativos |
| [Arquitetura](docs/architecture.md) | Fronteiras, responsáveis e limites de independência |
| [Estrutura e operação](docs/structure.md) | Diretórios, configuração, boot, erros e distribuição |
| [Protocolo de módulos](docs/modules.md) | Registro, fases, eventos e transações |
| [Migração](MIGRATION.md) | Composição explícita e compatibilidade existente |
| [Integração de pacotes](docs/package-integrations.md) | Banco, isolamento e recarga no host ThinkIac |
| [Validação](docs/testing.md) | Build, testes focados e distribuição isolada |
| [Contribuição](CONTRIBUTING.md) | Regras para manter a fronteira do launcher |

Aplicações ThinkIac devem consultar a [referência de decoradores](../../../docs/decorators.md)
para a sintaxe das capacidades da distribuição ativa. Verificação local não
representa publicação nem aceite de uma versão pelo Runtime.

## Desenvolvimento

```bash
npm run build
npm test
npm run test:independent
```

Node mínimo declarado: 18. Licença MIT, veja [LICENSE](LICENSE).
