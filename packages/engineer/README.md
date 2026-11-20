# Engineer

## CLI de pacotes

O binário `think` cria e valida pacotes Lógos independentes:

```sh
npx think engineer:createPackage calendar
npx think engineer:validatePackage calendar
npx think engineer:validatePackage calendar --applyAjusts
```

`engineer:createPackage` gera `package.json`, `index.js`, `README.md` e
`.github/workflows/ci.yml`. O CI executa a checagem e os testes em cada push e
pull request. Uma tag `v*` cria um ZIP instalável e publica uma GitHub Release.

`engineer:validatePackage` confere manifesto, ponto de entrada, README e CI. A
opção `--applyAjusts` gera os arquivos ausentes e completa `name`, `version` e
`main`. O nome legado `engineer:validityPackage` permanece suportado.

## Engineer v2

O modo Spec-Driven Design do Shell executa um ciclo de engenharia orientado por uma especificação aprovada. Clique no ícone **Engineer** na InputBar (ou em **More tools** se estiver fora dos atalhos fixados) ou envie `/spec`. O atalho `/spec <pedido>` preenche o primeiro trabalho da sessão. O painel requer uma conta administradora.

1. O servidor fixa o commit Git e coleta documentação do Lógos, convenções e referências de pacotes nessa revisão.
2. Um planejador Codex em modo somente leitura monta o Blueprint técnico. O plano cobre requisitos, arquivos, interfaces, decisões e critérios de aceite.
3. O Shell apresenta as dúvidas bloqueantes no StructuredInput. As respostas humanas revisam a especificação e podem gerar uma nova rodada de perguntas.
4. O Shell exibe o Blueprint e pede a aprovação da revisão. O servidor vincula a decisão ao administrador, ao trabalho, ao conteúdo do plano e ao commit base.
5. A aprovação cria uma branch de feature em um worktree separado. O Codex implementa e relata os testes. O servidor verifica branch, commit base, escopo do diff, conflitos, whitespace e sintaxe dos arquivos JavaScript e JSON alterados.
6. O painel apresenta o resultado e o caminho do worktree para revisão. O checkout ativo e a promoção para produção ficam fora deste fluxo.

O servidor conduz as etapas. O agente não precisa descobrir ou invocar uma tool de planejamento, aprovação ou construção. A aprovação duplicada ou enviada com uma revisão antiga é rejeitada.

## Runtime

- Rode o Thinkiac a partir de um checkout Git com os documentos do Lógos disponíveis em `HEAD`. A especificação parte do commit rastreado e alterações locais ficam no checkout original.
- O processo do Thinkiac precisa de um Codex CLI autenticado e suporte ao sandbox do sistema. `ENGINEER_CODEX_BIN` permite indicar o executável. A execução usa o `CODEX_HOME` do processo, quando configurado.
- As etapas são executadas pelo processo do Thinkiac. Configure `ENGINEER_STATE_DIR` com um diretório persistente privado por instância. Por padrão é `~/.local/state/thinkiac/engineer`. Os worktrees ficam em `worktrees/` nesse diretório. `ENGINEER_WORKTREE_DIR` pode apontar para outro volume persistente fora do checkout. Depois de um restart, uma etapa interrompida aparece no painel e qualquer worktree existente é retido para inspeção.
- A validação do servidor é estática. O relato do executor registra os testes que ele conseguiu rodar no sandbox. A v2 não oferece pausa interativa durante a construção.

Veja [pipeline](docs/pipeline.md) e [adaptadores](docs/host-adapters.md) para os contratos.

## CLI de pacotes

O binário `think` oferece criação e verificação de pacotes Lógos:

```sh
think engineer:createPackage calendar
think engineer:validatePackage calendar
think engineer:validatePackage calendar --applyAjusts
```

`engineer:createPackage` gera `package.json`, `index.js`, `README.md` e
`.github/workflows/ci.yml`. O workflow verifica sintaxe e testes a cada push e
pull request; ao publicar uma tag `v*`, cria o ZIP instalável e uma GitHub
Release. `engineer:validatePackage` confere o manifesto, o ponto de entrada, a
documentação e o CI. A opção `--applyAjusts` cria os arquivos ausentes e
completa `name`, `version` e `main` no manifesto. O nome legado
`engineer:validityPackage` continua aceito.
