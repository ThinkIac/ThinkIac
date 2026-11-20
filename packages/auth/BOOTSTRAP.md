# Provisionamento do administrador

O endpoint público `/auth/initial-admin` não cria contas. Configure as variáveis no ambiente privado do processo antes da primeira inicialização:

- `INITIAL_AUTH_USER`: nome de usuário (3 a 63 letras minúsculas, números ou hífens).
- `INITIAL_AUTH_EMAIL`: endereço de e-mail do administrador.
- `INITIAL_AUTH_PASSWORD`: senha com pelo menos 12 caracteres.
- `INITIAL_AUTH_NAME`: nome de exibição opcional.

O hook de inicialização cria um administrador somente quando não há outro administrador; contas existentes nunca são sobrescritas. Se o e-mail ou nome de usuário já pertencer a outra conta, o provisionamento falha. Alternativamente, com as mesmas variáveis no ambiente, execute `think auth:create-user` no host. O comando inicializa os serviços necessários sem abrir o servidor HTTP.

Forneça a senha por um mecanismo de segredos do sistema ou arquivo de ambiente protegido, nunca em argumentos ou histórico do terminal. O Auth também carrega `packages/auth/.env` se presente; restrinja suas permissões e não o versione. Remova as variáveis e credenciais de bootstrap após a criação. Se todas as contas administrativas forem removidas, configure as variáveis novamente somente quando for necessário recuperar o acesso localmente.
