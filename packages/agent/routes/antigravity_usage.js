


import { existsSync } from 'fs'
import { join } from 'path'
import { discoverTerminalAntigravityAccounts } from '../llm/terminal_accounts.js'
import { ANTIGRAVITY } from '../llm/antigravity_cli.js'

export async function antigravityUsage() {
  /**
   * @register_router antigravity-usage
   * @method GET
   * @description Estado de login das contas Antigravity por perfil do Terminal.
   */
  const accounts = discoverTerminalAntigravityAccounts().map(a => ({
    name: a.name, logged_in: existsSync(join(a.config_dir, ANTIGRAVITY.credentialFile)),
  }))
  return { success: true, accounts, logged_in: accounts.filter(a => a.logged_in).length, quota_available: false,
    message: 'Login reconhecido. O CLI não oferece uma API pública de quota; o Agent não lê tokens nem usa endpoints privados.' }
}
