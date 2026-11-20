import '../runtime/config.js';
import { googleAuth } from '../services/google-provider.js';
import { ticket as ticketHandler } from '../services/login-tickets.js';
import { login as loginHandler } from '../services/password-login.js';
import { logout as logoutHandler } from '../services/password-login.js';
import { issueDelegatedTicket as issueDelegatedTicketHandler } from '../services/delegated-sessions.js';
import { consumeDelegatedTicket as consumeDelegatedTicketHandler } from '../services/delegated-sessions.js';
import { getUser as getUserHandler } from '../services/lifecycle.js';
import { enter as enterHandler } from '../services/app-entry.js';
import { enterDistributedApp as enterDistributedAppHandler } from '../services/app-entry.js';

export async function login(req, res) {
    /**
     * @register_router login
     * @public true
     * @method POST
     */
    return loginHandler(req, res);
}

export async function logout(req, res) {
    /**
     * @register_router logout
     * @public true
     * @method GET
     */
    return logoutHandler(req, res);
}

export async function getUser(req, res) {
    /**
     * @register_router get
     * @method GET
     */
    return getUserHandler(req, res);
}

export async function initialSetupStatus(req) {
    /**
     * @register_router initial-setup
     * @public true
     * @method GET
     */
    return { initialSetupRequired: false, settings: { registrationEnabled: false, invitationsEnabled: false } };
}

export async function createInitialAdmin(req, res) {
    /**
     * @register_router initial-admin
     * @public true
     * @method POST
     */
    return res.status(403).send({ error: 'Initial setup is no longer available. Provision an administrator locally.' });
}

export async function googleStart(req, res) {
    /**
     * @register_router google/start
     * @method GET
     */
    return googleAuth.googleStart(req, res);
}

export async function googleCallback(req, res) {
    /**
     * @register_router google/callback
     * @method GET
     */
    return googleAuth.googleCallback(req, res);
}

export async function ticket(req, res) {
    /**
     * @register_router ticket
     * @method GET
     */
    return ticketHandler(req, res);
}

export async function enter(req, res) {
    /**
     * @register_router enter
     * @method GET
     * @requireCredential
     *
     * Compatibilidade para links antigos. Entrar não cria nem acorda tenant:
     * a escolha de destino pertence ao Redirect e às regras de cargo.
     */
    return enterHandler(req, res);
}

export async function enterDistributedApp(req, res) {
    /**
     * @register_router apps/:app/enter
     * @method GET
     * @requireCredential
     *
     * Aquisição pública e entrada canônica do app. A mesma URL funciona antes
     * e depois de existir Tenant, portanto links distribuídos nunca precisam
     * conhecer a topologia da conta.
     */
    return enterDistributedAppHandler(req, res);
}

export async function issueDelegatedTicket(req, res) {
    /**
     * @register_router delegation/issue
     * @method POST
     */
    return issueDelegatedTicketHandler(req, res);
}

export async function consumeDelegatedTicket(req, res) {
    /**
     * @register_router delegation
     * @method GET
     */
    return consumeDelegatedTicketHandler(req, res);
}
