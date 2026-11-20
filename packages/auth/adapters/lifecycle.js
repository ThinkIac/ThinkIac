import '../runtime/config.js';
import { provisionInitialAdmin, manageUserCommand } from '../services/local-users.js';
import { onResolveProxyToken as onResolveProxyTokenHandler, onRecordProxySpend as onRecordProxySpendHandler } from '../services/credentials.js';
import { getProxy } from 'logos';
import { setupUser as setupUserHandler } from '../services/lifecycle.js';
import { credentialVerify as credentialVerifyHandler } from '../services/lifecycle.js';
import { onGetAdminUser as onGetAdminUserHandler } from '../services/lifecycle.js';

export async function setupUser(payload, context) {
    /**
     * @register_hook boot
     */
    return setupUserHandler(payload, context);
}

export async function credentialVerify(payload, ctx) {
    /**
     * @register_hook credential:verify
     * Provider de sessão ThinkIac para o guard neutro de credenciais.
     */
    return credentialVerifyHandler(payload, ctx);
}

export async function onResolveProxyToken(payload) {
    /**
     * @register_hook auth:resolve-proxy-token
     */
    return onResolveProxyTokenHandler(payload);
}

export async function onRecordProxySpend(payload) {
    /**
     * @register_hook auth:record-proxy-spend
     */
    return onRecordProxySpendHandler(payload);
}

export async function onGetAdminUser() {
    /**
     * @register_hook auth:get-admin-user
     *
     * Usado por billing (onAgentTokenUsage) pra atribuir uso de LLM sem
     * Tenant/token resolvido (ex.: esta própria instância, que usa chaves/CLI
     * pessoais do operador) a um usuário real com role "admin" — em vez de um
     * bucket sintético sem carteira/identidade, permitindo que o admin veja
     * esse consumo na própria tela de billing.
     */
    return onGetAdminUserHandler();
}

export async function createUserCommand() {
    /**
     * @register_command create-user
     * @description Provisiona um administrador inicial usando variáveis de ambiente, sem passar senha em argumentos.
     * @cli_runtime full
     */
    return provisionInitialAdmin(getProxy('auth'), process.env);
}

export async function addUserCommand() {
    /** @register_command add-user
     * @description Cria uma conta local usando variáveis AUTH_USER_.
     * @cli_runtime full
     */
    return manageUserCommand(getProxy('auth'), 'create');
}

export async function listUsersCommand() {
    /** @register_command list-users
     * @description Lista contas locais.
     * @cli_runtime full
     */
    return manageUserCommand(getProxy('auth'), 'list');
}

export async function getUserCommand() {
    /** @register_command get-user
     * @description Consulta uma conta por AUTH_USER_ID.
     * @cli_runtime full
     */
    return manageUserCommand(getProxy('auth'), 'get');
}

export async function updateUserCommand() {
    /** @register_command update-user
     * @description Atualiza uma conta por AUTH_USER_ID.
     * @cli_runtime full
     */
    return manageUserCommand(getProxy('auth'), 'update');
}

export async function disableUserCommand() {
    /** @register_command disable-user
     * @description Desativa uma conta por AUTH_USER_ID.
     * @cli_runtime full
     */
    return manageUserCommand(getProxy('auth'), 'disable');
}

export async function enableUserCommand() {
    /** @register_command enable-user
     * @description Reativa uma conta por AUTH_USER_ID.
     * @cli_runtime full
     */
    return manageUserCommand(getProxy('auth'), 'enable');
}
