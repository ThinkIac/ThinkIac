---
name: GitHub
description: Use quando o pedido envolver Git, GitHub, repositórios, branches, commits, push, pull, issues ou pull requests.
language: pt-BR
always: true
---

# Git e GitHub

Para operações em repositórios GitHub, use primeiro as tools do pacote `github`.
Antes de informar indisponibilidade, descubra e execute a tool adequada.

As tools de packages podem não aparecer como chamadas diretas no harness. Nesse
caso, procure a capacidade com `list_runtime_tools`, restringindo a busca ao
package `github`, e execute o nome retornado por meio de `run_runtime_tool`, com
`package: "github"`, `tool` e `args`. A ausência de uma tool direta no catálogo
do modelo não significa que a tool do package esteja indisponível. Só informe
indisponibilidade depois que a descoberta específica retornar vazia ou a execução
falhar, citando o erro concreto. Não invente nomes nem parâmetros: use o schema
retornado pela descoberta.

Exemplo conceitual para publicação:

1. Descubra `github_push` no package `github` com `list_runtime_tools`.
2. Execute `run_runtime_tool({ package: "github", tool: "github_push", args: {
   repo, branch, message } })`.
3. Leia o retorno e valide a branch remota com `github_list_branches`, também via
   `run_runtime_tool` quando ela não estiver exposta diretamente.

Quando as credenciais estiverem configuradas e a tool responder, use a autenticação
mantida pelo pacote, sem expor nem copiar chaves ou tokens para a conversa,
comandos ou arquivos. O pacote prioriza o token configurado para clone, pull e
push e usa SSH quando não houver token. Quando uma tool indicar ausência, falha
de formato ou falta de permissão das credenciais, explique o erro concreto e
oriente o usuário a configurar ou corrigir SSH e token em **Settings → GitHub**.
Não tente contornar isso com credenciais do shell, arquivos privados ou uma chave
fornecida no chat.

## Fluxo de publicação

1. Inspecione o estado e o destino antes de mudar qualquer coisa.
2. Para um repositório ainda não clonado pelo pacote, use
   `github_clone_repository`.
3. Faça mudanças somente nos arquivos autorizados pelo pedido e revise o diff.
4. Use `github_push` para adicionar, criar commit e enviar a branch. Informe uma
   mensagem de commit objetiva.
5. Valide a publicação com `github_list_branches` ou pela API do GitHub. Para
   mudanças que devem passar por revisão, crie uma branch e um pull request com
   `github_create_pull_request`.

## Regras de segurança

- Nunca leia, imprima, versione ou transmita chaves privadas, tokens, arquivos
  `.env`, configurações privadas ou outros segredos.
- Nunca faça `git reset --hard`, force-push, remoção de branch ou reescrita de
  histórico sem autorização explícita.
- Não publique alterações não relacionadas que já estavam no diretório de
  trabalho. Confirme os arquivos incluídos antes do push.
- Se a tool não estiver disponível ou o repositório atual não for um clone
  gerenciado, explique a limitação e peça direção antes de usar outro caminho de
  autenticação.
