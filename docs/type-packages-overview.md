# Overview: Pacotes `.type` sem `dist/` nem `.cjs`

## Objetivo

Disponibilizar pacotes ThinkIac como arquivos `.type` (CoffeeScript 2 com anotações Lógos) que o Lógos possa baixar e interpretar em execução, sem necessidade de infraestrutura de build (`dist/`, `.cjs`, compilação prévia).

## Estado atual

### Módulos `.type` já existentes

| Módulo | Localização | Descrição |
|--------|-------------|-----------|
| `repo` | `packages/github/.private/repos/repo/src/index.type` | Hosting de repositório auto-git (SSH, deploy, branches, proxy) |
| `transport` | `packages/github/.private/repos/repo/src/transport/index.type` | Transportes SSH, deploy, branches, proxy, keys, git, delegation |
| `tools-bridge` | `packages/github/.private/repos/tools/src/tools-bridge.type` | Bridge de ferramentas |
| Módulos ThinkIac | `packages/github/.private/repos/ThinkIac/.thinkiac/default/generations/.../vendor/packages/modules/` | Gerações instaladas com `.type` |

### Formato `.type`

```coffee
# Exemplo simplificado
provideRepo = (host) ->
  ###*
  # @register module repo
  # @context capability
  ###
  state = null
  {
    name: 'repo'
    phase: 'wire'
    after: ['http', 'tools']
    close: -> ...
    api: ...
    install: -> ...
  }

module.exports = provideRepo: provideRepo
```

Anotações suportadas:
- `@register module <nome>` — registra módulo de capacidade
- `@register_router <nome> @method <HTTP>` — registra rota HTTP
- `@register_tool <nome>` — registra tool
- `@context <tipo>` — contexto de execução (capability, tool, router)

## O que precisa ser feito por pacote

### 1. Verificar `package.json`
```json
{
  "name": "pacote",
  "version": "1.0.0",
  "type": "module",
  "main": "index.type",
  "dependencies": { "logos": "*" }
}
```

### 2. Garantir declarações corretas
- `@register module` com `name`, `phase`, `after`, `close`, `api`, `install`
- `@register_router` para rotas HTTP
- `@register_tool` para tools

### 3. Remover dependências de `dist/`
- Não importar de `dist/`
- Não depender de arquivos `.cjs` compilados
- Usar apenas imports relativos a `.type` ou dependências npm

### 4. Testar interpretação em execução
```bash
# O Lógos deve conseguir:
logos load ./pacote/index.type
logos run --module pacote
```

## Pacotes candidatos para migração

| Pacote | Tem `.type`? | Tem `dist/`? | Status |
|--------|--------------|--------------|--------|
| `repo` | ✅ | ❌ (em `.private`) | Pronto |
| `transport` | ✅ | ❌ (em `.private`) | Pronto |
| `agent` | ❓ | ❓ | Verificar |
| `auth` | ❓ | ❓ | Verificar |
| `terminal` | ❓ | ❓ | Verificar |
| `openai-bridge` | ❓ | ❓ | Verificar |

## Próximos passos

1. **Inventário completo** — Listar todos os pacotes com `.type` no repositório
2. **Teste de carga** — Verificar se `logos load` funciona com `.type` direto
3. **Contrato mínimo** — Documentar declarações obrigatórias para auto-descoberta
4. **Migração incremental** — Converter um pacote por vez, validando em execução
5. **Remoção de `dist/`** — Após validação, remover infraestrutura de build dos pacotes migrados

## Referências

- [Issue #75](https://github.com/ThinkIac/ThinkIac/issues/75)
- [LogosType docs](docs/logostype.md)
- [Módulos Lógos](vendor/packages/logos/docs/modules.md)
