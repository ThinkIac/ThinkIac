# Provisionamento do administrador

O endpoint público `/auth/initial-admin` não cria contas. Configure as variáveis no ambiente privado do processo antes da primeira inicialização:

- `INITIAL_AUTH_USER`: nome de usuário (3 a 63 letras minúsculas, números ou hífens).
- `INITIAL_AUTH_EMAIL`: endereço de e-mail do administrador.
- `INITIAL_AUTH_PASSWORD`: senha com pelo menos 12 caracteres.
- `INITIAL_AUTH_NAME`: nome de exibição opcional.

O hook de inicialização cria um administrador somente quando não há outro administrador; contas existentes nunca são sobrescritas. Se o e-mail ou nome de usuário já pertencer a outra conta, o provisionamento falha. Alternativamente, com as mesmas variáveis no ambiente, execute `think auth:create-user` no host. O comando inicializa os serviços necessários sem abrir o servidor HTTP.

Forneça a senha por um mecanismo de segredos do sistema ou arquivo de ambiente protegido, nunca em argumentos ou histórico do terminal. O Auth também carrega `packages/auth/.env` se presente; restrinja suas permissões e não o versione. Remova as variáveis e credenciais de bootstrap após a criação. Se todas as contas administrativas forem removidas, configure as variáveis novamente somente quando for necessário recuperar o acesso localmente.

## Administração local de usuários

Os comandos abaixo exigem acesso ao host e ao banco do Runtime. Esse acesso equivale a privilégios administrativos; não exponha os comandos a usuários não confiáveis. Eles registram alterações na auditoria como `local-cli`, sem identificar o operador do sistema operacional nem registrar senhas. Execute uma operação administrativa por vez para evitar alterações concorrentes.

- `think auth:add-user`: cria conta com `AUTH_USER_USERNAME`, `AUTH_USER_EMAIL` e `AUTH_USER_PASSWORD` (mínimo 12 caracteres). `AUTH_USER_NAME` e `AUTH_USER_ROLE` (`user` ou `admin`, padrão `user`) são opcionais.
- `think auth:list-users`: lista IDs e dados básicos, sem credenciais.
- `think auth:get-user`: consulta a conta indicada por `AUTH_USER_ID`.
- `think auth:update-user`: altera apenas as variáveis `AUTH_USER_USERNAME`, `AUTH_USER_EMAIL`, `AUTH_USER_NAME`, `AUTH_USER_ROLE` e `AUTH_USER_PASSWORD` definidas para o `AUTH_USER_ID`.
- `think auth:disable-user` e `think auth:enable-user`: desativam ou reativam a conta indicada por `AUTH_USER_ID`. A desativação é a exclusão lógica; os dados e associações são preservados.

Defina essas variáveis em um ambiente protegido, sem inserir senhas em argumentos ou histórico. Limpe variáveis de operações anteriores antes de atualizar uma conta. Desativar ou rebaixar o último administrador ativo é recusado. A desativação e a troca de senha removem as sessões existentes; uma conta desativada não pode autenticar. Os comandos não gerenciam permissões de grupos nem removem infraestrutura de tenants.
