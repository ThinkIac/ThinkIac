# Lógos

Lógos é o launcher e o protocolo de composição do ThinkIac. O kernel coordena
catálogo, dependências, declarações, autoridade e ciclo de vida. Recursos concretos
são fornecidos pelos módulos selecionados pelo host.

O pacote não declara dependências de execução obrigatórias nem opcionais.
A distribuição empacotada pode iniciar sem HTTP, banco, Svelte, workers,
estabilizador ou diretório de módulos adjacente. Há fachadas de compatibilidade;
isso não significa que todos os consumidores já usem snapshots transacionais.

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
continua sendo descoberto, inclusive seus module-packages. Para um boot realmente
vazio, use um workspace vazio. Omitir `externalModules` mantém a descoberta legada.
Configurar `http`, `views` ou `workers` não instala seus provedores.

## Compor um host

O host instala as dependências de cada capacidade e seleciona caminhos relativos
ao workspace (`./arithmetic`), caminhos absolutos ou nomes npm em
`externalModules`. O ponto de entrada nativo exporta `register(context)`:

```js
// arithmetic/index.cjs
exports.register = context => context.register({
  name: 'arithmetic', version: '1.0.0', phase: 'wire',
  resources: {
    arithmetic: resource => context.state.set(resource.declaration.name, resource.handler),
  },
  install(ctx) { ctx.log('instalado'); },
  close() { context.state.clear(); },
});
```

O módulo define a semântica de `@register arithmetic double`; Lógos transporta
metadados e um handler mediado. Esse consumidor simples não oferece rollback
automático dos seus efeitos. Para recarga segura, use o consumidor transacional.
Fábricas `createRuntimeModule(host)` continuam funcionando pelo adaptador externo.

## Referências

| Documento | Conteúdo |
| --- | --- |
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
