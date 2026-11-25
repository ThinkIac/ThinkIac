# Integração de pacotes

Esta referência resume os contratos do Lógos usados pelo
[mapa central de integrações](../../../../README.md#contratos-de-pacotes-e-interface). O kernel Lógos
descobre o `package.json` e coordena o carregamento; os módulos selecionados
provisionam os recursos; campos
de interface como menu, widget e abas são interpretados pelos hosts de UI.

Os contratos abaixo descrevem a composição ThinkIac. Banco/schema/vault exigem
`db`; processos isolados exigem `isolated-runtime`; recarga exige `stabilizer`.
Uma instalação vazia não oferece essas capacidades. Veja [estrutura](structure.md).

## Banco e isolamento

Um pacote com `schema.prisma` recebe um tenant de banco próprio. Isso separa o
schema e o diretório do pacote, mas não transforma o tenant comum numa fronteira
criptográfica.

Dados exclusivos do dono exigem as duas declarações de topo:

```json
{
  "isolated": true,
  "database": "private"
}
```

Nesse modo, o código roda no processo filho isolado e o tenant privado é cifrado
em repouso pelo vault SQLCipher. Outros pacotes não adquirem esse tenant pelo
proxy de banco; o dono deve expor somente operações mediadas por tool, rota ou
evento. A implantação continua responsável por proteger chaves, backups, logs e
qualquer dado exportado pelo próprio pacote.

## Recarga e estado crítico

Recarga, validação e rollback acontecem por pacote. Quando uma mudança inclui
`schema.prisma`, código e banco precisam participar do mesmo candidato para que
uma falha restaure o estado consistente anterior.

`runtime.isolation.critical` trata disponibilidade, não sigilo. Ele informa que
uma reinicialização global pode derrubar estado ou sessões importantes e permite
que o host bloqueie uma reinicialização silenciosa enquanto houver impacto.
Esse campo é diferente de `isolated: true`, que escolhe execução em processo
filho, e de `database: "private"`, que seleciona o banco privado cifrado.
