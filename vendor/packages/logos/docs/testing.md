# Validação do Lógos

Execute a partir de `vendor/packages/logos`, com dependências de desenvolvimento:

```bash
npm run build
npx vitest run tests/container.test.ts tests/runtime-protocol.test.ts tests/resource-transactions.test.ts tests/module-independence.test.ts
npm run test:independent
npm test
```

O build precede o teste de distribuição, que empacota `dist` com `--ignore-scripts`.
A suíte completa inclui regressões de capacidades externas; sua localização
histórica não indica propriedade da implementação.

| Teste | Evidência |
| --- | --- |
| `independent-distribution.test.cjs` | Artefato sem dependências de produção, boot vazio, módulo nativo, recurso arbitrário, tipos públicos e workers empacotados separadamente |
| `module-independence.test.ts` | Contexto restrito, instâncias e capacidades mediadas |
| `runtime-protocol.test.ts` | Catálogo selado, ciclo versionado e recursos genéricos |
| `resource-transactions.test.ts` | Preparação, commit, compensação, concorrência e descarte |
| `container.test.ts` | Dependências, fases e ciclos |
| `external-module-discovery.test.ts` | Descoberta por manifest |
| `declarations.test.ts`, `declaration-events.test.ts` | Metadados genéricos e handler separado |
| `logos-dependencies.test.ts` | Dependências estruturais de pacotes |
| `dependency-preparation.test.ts` | Dependências sem entrypoint CommonJS, produção, falha e nova tentativa de instalação |
| `http-module.test.ts` | Integração HTTP com o boot |

Execute também os testes do módulo alterado em `../modules/<nome>`, conforme seu
manifest. No host completo, valide boot, adição de pacote, reload, rollback e
encerramento. Use fixtures temporárias reais para scanners. Não altere `HOME`
nem use o workspace ativo como fixture.

Execuções anteriores relataram `supertest` ausente, fixtures Android ausentes e
divergência de cache Svelte. São relatos históricos, não resultados atuais.
Registre comando e falha observada antes de atribuí-la à mudança em avaliação.

Build aprovado não comprova comportamento; testes focados não comprovam toda a
composição. Distribuição isolada comprova o artefato local testado, sem publicar
uma versão nem fornecer aceite pelo Runtime em execução.
