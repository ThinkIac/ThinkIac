import '../runtime/config.js';
import { listUsers as listUsersHandler } from '../services/user-administration.js';
import { updateUser as updateUserHandler } from '../services/user-administration.js';
import { deleteUser as deleteUserHandler } from '../services/user-administration.js';
import { createAccount as createAccountHandler } from '../services/user-administration.js';
import { saveOnboarding as saveOnboardingHandler } from '../services/onboarding.js';
import { getOnboardingByProxyToken as getOnboardingByProxyTokenHandler } from '../services/onboarding.js';

export async function listUsers(req, res) {
    /**
     * @register_router users
     * @method GET
     * @requireCredential
     */
    return listUsersHandler(req, res);
}

export async function updateUser(req, res) {
    /**
     * @register_router update-user
     * @method POST
     * @requireCredential
     */
    return updateUserHandler(req, res);
}

export async function deleteUser(req, res) {
    /**
     * @register_router delete-user
     * @method POST
     * @auth
     */
    return deleteUserHandler(req, res);
}

export async function createAccount(req, res) {
    /**
     * @register_router create-account
     * @method POST
     * @auth
     *
     * Cria uma conta local do Runtime, sem provisionamento de infraestrutura.
     */
    return createAccountHandler(req, res);
}

export async function saveOnboarding(req, res) {
    /**
     * @register_router onboarding
     * @method POST
     * @auth
     *
     * Salva (merge, não substitui) as respostas da Parte 1. Chamado
     * incrementalmente conforme o usuário avança os passos na tela de espera
     * — pode ficar incompleto se ele fechar a aba antes de terminar; a Parte 2
     * (dentro do tenant) não depende de nenhum campo específico estar presente.
     */
    return saveOnboardingHandler(req, res);
}

export async function getOnboardingByProxyToken(req, res) {
    /**
     * @register_router onboarding/by-proxy-token
     * @method GET
     *
     * Mesmo padrão de wallet/by-proxy-token (packages/billing): autenticado
     * pelo LLM_PROXY_TOKEN do tenant (Bearer) em vez de sessão de cookie — é
     * o que tenant-auth usa, de dentro do container, no primeiro SSO, pra
     * puxar as respostas da Parte 1 e semear o AGENT.md/mensagem de boas-vindas
     * do Agent (ver hooks/onboarding.js no pacote agent).
     */
    return getOnboardingByProxyTokenHandler(req, res);
}
