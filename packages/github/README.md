# GitHub Tools

O pacote oferece Tools para repositórios, branches, Git por SSH, Issues e Pull Requests. A tela GitHub em **Settings → Chaves de integrações** mostra a chave pública SSH, recebe o Personal Access Token e configura nome/e-mail dos commits.

Cadastre a chave pública exibida no GitHub em **Settings → SSH and GPG keys**. O token é necessário para operações da API; a chave SSH é usada para clonar, puxar e enviar commits. O token e a chave privada são gravados em `packages/github/.private/settings.json` com permissão `0600`; clones e chave SSH do host ficam no mesmo diretório privado.

Push e Pull trabalham apenas em clones criados pela Tool `github_clone_repository`, dentro de `.private/repos/`. Push adiciona alterações rastreadas e não rastreadas, cria commit se necessário e envia a branch indicada ou a atual. Pull usa fast-forward e falha se houver divergência que exija merge manual. O host precisa ter `git` e `ssh` instalados.
