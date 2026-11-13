import { readConfig, saveConfig } from './lib/config.js'
import { githubRequest, repositoryPath } from './lib/github-api.js'
import { cloneRepository, createBranch as createLocalBranch, localBranches, pullRepository, pushRepository, publicSshKey, setGitIdentity } from './lib/git.js'

const GITHUB_CREDENTIALS_SURFACE = Object.freeze({
  version: 1, kind: 'github-credentials', eyebrow: 'Credenciais de integração', title: 'GitHub',
  description: 'Configure a chave SSH, o token da API e a identidade usada nos commits.',
  extra: { kind: 'github-credentials', actions: { save: 'github.credentials.save' } },
  actions: { 'github.credentials.save': { intent: 'write' } },
})

function encoded(value) { return encodeURIComponent(String(value || '')) }

/** @register_router settings @method GET */
export async function getSettings() {
  const config = await readConfig()
  return { configured: Boolean(config.token), tokenConfigured: Boolean(config.token), name: config.name, email: config.email, publicKey: await publicSshKey() }
}

/** @register_router settings @method PUT */
export async function updateSettings(req) {
  const body = req?.body || {}
  const name = String(body.name || '').trim()
  const email = String(body.email || '').trim()
  if (name.length > 200 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return { status: 400, error: 'Informe nome e e-mail válidos.' }
  const current = await readConfig()
  const config = await saveConfig({ name, email, token: body.clearToken ? '' : (body.token || current.token) })
  return { configured: Boolean(config.token), tokenConfigured: Boolean(config.token), name: config.name, email: config.email, publicKey: await publicSshKey() }
}

/** @register_router system/view @method GET */
export async function systemView(req) {
  if (req?.query?.tab && req.query.tab !== 'github-credentials') return { status: 404, mensagem: 'Aba GitHub não encontrada.' }
  const config = await readConfig()
  return {
    status: 200,
    surface: GITHUB_CREDENTIALS_SURFACE,
    state: { configured: Boolean(config.token), tokenConfigured: Boolean(config.token), name: config.name, email: config.email, publicKey: await publicSshKey() },
  }
}

/** @register_router system/action @method POST */
export async function systemAction(req) {
  if (req?.query?.tab && req.query.tab !== 'github-credentials') return { status: 404, mensagem: 'Aba GitHub não encontrada.' }
  if (req?.body?.action !== 'github.credentials.save') return { status: 404, mensagem: 'Ação de integração não permitida.' }
  const result = await updateSettings({ body: req.body.values || {} })
  if (result.status >= 400) return { ...result, mensagem: result.error || 'Não foi possível salvar as configurações.' }
  return { status: 200, state: result, notice: 'Configurações do GitHub salvas.' }
}

/** @register_tool github_generate_ssh_key
 * @description Gera ou retorna a chave pública SSH Ed25519 para cadastrar nas configurações do usuário GitHub. A chave privada fica no diretório privado do pacote.
 */
export async function generateSshKey() { return { publicKey: await publicSshKey(), format: 'OpenSSH Ed25519' } }

/** @register_tool github_list_repositories
 * @description Lista repositórios acessíveis pela conta GitHub configurada.
 * @param {number?} perPage - Quantidade por página (máximo 100)
 * @param {number?} page - Página da lista
 */
export async function listRepositories({ perPage = 30, page = 1 } = {}) {
  const result = await githubRequest(`/user/repos?per_page=${Math.min(100, Math.max(1, Number(perPage) || 30))}&page=${Math.max(1, Number(page) || 1)}&sort=updated`)
  return { repositories: result.map(repo => ({ id: repo.id, name: repo.name, fullName: repo.full_name, description: repo.description, private: repo.private, url: repo.html_url, cloneSshUrl: repo.ssh_url, defaultBranch: repo.default_branch })) }
}

/** @register_tool github_create_repository
 * @description Cria um repositório na conta autenticada do GitHub.
 * @param {string} name - Nome do novo repositório
 * @param {string?} description - Descrição
 * @param {boolean?} private - Criar como privado (padrão: true)
 * @param {boolean?} autoInit - Criar com README inicial
 */
export async function createRepository({ name, description = '', private: isPrivate = true, autoInit = false } = {}) {
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(name || '')) throw new Error('Nome de repositório inválido.')
  const repo = await githubRequest('/user/repos', { method: 'POST', body: { name, description, private: Boolean(isPrivate), auto_init: Boolean(autoInit) } })
  return { id: repo.id, name: repo.name, fullName: repo.full_name, url: repo.html_url, cloneSshUrl: repo.ssh_url, defaultBranch: repo.default_branch }
}

/** @register_tool github_edit_repository
 * @description Altera nome, descrição, visibilidade ou configurações básicas de um repositório.
 * @param {string} owner - Proprietário
 * @param {string} repo - Repositório
 * @param {string?} name - Novo nome
 * @param {string?} description - Nova descrição
 * @param {boolean?} private - Visibilidade privada
 * @param {boolean?} archived - Arquivar ou desarquivar
 */
export async function editRepository({ owner, repo, name, description, private: isPrivate, archived } = {}) {
  const body = Object.fromEntries(Object.entries({ name, description, private: isPrivate, archived }).filter(([, value]) => value !== undefined))
  if (!Object.keys(body).length) throw new Error('Informe ao menos uma propriedade para atualizar.')
  const result = await githubRequest(repositoryPath(owner, repo), { method: 'PATCH', body })
  return { id: result.id, name: result.name, fullName: result.full_name, description: result.description, private: result.private, archived: result.archived, url: result.html_url }
}

/** @register_tool github_list_branches
 * @description Lista branches remotas de um repositório do GitHub.
 * @param {string} owner - Proprietário
 * @param {string} repo - Repositório
 */
export async function listBranches({ owner, repo } = {}) {
  const result = await githubRequest(`${repositoryPath(owner, repo)}/branches?per_page=100`)
  return { branches: result.map(item => ({ name: item.name, protected: item.protected, commit: item.commit.sha })) }
}

/** @register_tool github_create_branch
 * @description Cria branch no GitHub a partir de uma referência SHA existente.
 * @param {string} owner - Proprietário
 * @param {string} repo - Repositório
 * @param {string} branch - Nome da nova branch
 * @param {string} from - SHA ou nome da branch de origem
 */
export async function createRemoteBranch({ owner, repo, branch, from = 'main' } = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/.test(branch || '') || branch.includes('..') || branch.endsWith('/')) throw new Error('Nome de branch inválido.')
  const base = await githubRequest(`${repositoryPath(owner, repo)}/commits/${encoded(from)}`)
  const result = await githubRequest(`${repositoryPath(owner, repo)}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${branch}`, sha: base.sha } })
  return { branch: result.ref.replace('refs/heads/', ''), sha: result.object.sha }
}

/** @register_tool github_clone_repository
 * @description Clona um repositório por SSH para o diretório privado gerenciado pelo pacote, preparando Push e Pull.
 * @param {string} owner - Proprietário
 * @param {string} repo - Repositório
 * @param {string?} branch - Branch inicial
 */
export async function cloneGithubRepository({ owner, repo, branch } = {}) { return { repo, ...(await cloneRepository({ owner, repo, defaultBranch: branch })) } }

/** @register_tool github_list_local_branches
 * @description Lista branches locais do repositório previamente clonado pelo ThinkIac.
 * @param {string} repo - Nome local do repositório
 */
export async function listLocalBranches({ repo } = {}) { return localBranches(repo) }

/** @register_tool github_create_local_branch
 * @description Cria e seleciona uma branch no clone local.
 * @param {string} repo - Nome local do repositório
 * @param {string} branch - Nome da branch
 * @param {string?} from - Branch ou referência de origem (padrão HEAD)
 */
export async function createLocalBranchTool({ repo, branch, from = 'HEAD' } = {}) { return { repo, ...(await createLocalBranch(repo, branch, from)) } }

/** @register_tool github_pull
 * @description Atualiza o clone local por fast-forward da branch remota.
 * @param {string} repo - Nome local do repositório
 * @param {string?} branch - Branch remota; omitida usa a branch atual
 */
export async function pull({ repo, branch } = {}) { return { repo, ...(await pullRepository(repo, branch)) } }

/** @register_tool github_push
 * @description Envia alterações locais ao GitHub. Adiciona mudanças, cria commit quando necessário e publica a branch via SSH.
 * @param {string} repo - Nome local do repositório
 * @param {string?} branch - Branch de destino; omitida usa a branch atual
 * @param {string?} message - Mensagem do commit se houver mudanças
 */
export async function push({ repo, branch, message } = {}) { return { repo, ...(await pushRepository(repo, branch, message)) } }

/** @register_tool github_set_git_identity
 * @description Define nome e e-mail que assinam commits do clone e armazena-os nas configurações do GitHub.
 * @param {string} repo - Nome local do repositório
 * @param {string} name - Nome do autor dos commits
 * @param {string} email - E-mail do autor dos commits
 */
export async function setIdentity({ repo, name, email } = {}) { return setGitIdentity(repo, name, email) }

/** @register_tool github_list_issues
 * @description Lista Issues abertas ou fechadas; Pull Requests não são incluídos.
 * @param {string} owner - Proprietário
 * @param {string} repo - Repositório
 * @param {string?} state - all, open ou closed
 */
export async function listIssues({ owner, repo, state = 'open' } = {}) {
  const result = await githubRequest(`${repositoryPath(owner, repo)}/issues?state=${encodeURIComponent(['open', 'closed', 'all'].includes(state) ? state : 'open')}&per_page=100`)
  return { issues: result.filter(item => !item.pull_request).map(item => ({ number: item.number, title: item.title, state: item.state, url: item.html_url, body: item.body, user: item.user?.login })) }
}

/** @register_tool github_create_issue
 * @description Cria Issue em um repositório.
 * @param {string} owner - Proprietário
 * @param {string} repo - Repositório
 * @param {string} title - Título
 * @param {string?} body - Descrição
 */
export async function createIssue({ owner, repo, title, body = '' } = {}) {
  const result = await githubRequest(`${repositoryPath(owner, repo)}/issues`, { method: 'POST', body: { title, body } })
  return { number: result.number, title: result.title, url: result.html_url, state: result.state }
}

/** @register_tool github_comment_issue
 * @description Adiciona comentário a uma Issue.
 * @param {string} owner - Proprietário
 * @param {string} repo - Repositório
 * @param {number} issueNumber - Número da Issue
 * @param {string} body - Comentário
 */
export async function commentIssue({ owner, repo, issueNumber, body } = {}) {
  const result = await githubRequest(`${repositoryPath(owner, repo)}/issues/${Number(issueNumber)}/comments`, { method: 'POST', body: { body } })
  return { id: result.id, url: result.html_url, createdAt: result.created_at }
}

/** @register_tool github_list_pull_requests
 * @description Lista Pull Requests do repositório.
 * @param {string} owner - Proprietário
 * @param {string} repo - Repositório
 * @param {string?} state - all, open ou closed
 */
export async function listPullRequests({ owner, repo, state = 'open' } = {}) {
  const result = await githubRequest(`${repositoryPath(owner, repo)}/pulls?state=${encodeURIComponent(['open', 'closed', 'all'].includes(state) ? state : 'open')}&per_page=100`)
  return { pullRequests: result.map(item => ({ number: item.number, title: item.title, state: item.state, url: item.html_url, head: item.head.ref, base: item.base.ref, body: item.body })) }
}

/** @register_tool github_create_pull_request
 * @description Cria Pull Request a partir da branch head para a branch base.
 * @param {string} owner - Proprietário
 * @param {string} repo - Repositório
 * @param {string} title - Título
 * @param {string} head - Branch de origem
 * @param {string} base - Branch de destino
 * @param {string?} body - Descrição
 */
export async function createPullRequest({ owner, repo, title, head, base, body = '' } = {}) {
  const result = await githubRequest(`${repositoryPath(owner, repo)}/pulls`, { method: 'POST', body: { title, head, base, body } })
  return { number: result.number, title: result.title, url: result.html_url, state: result.state }
}

/** @register_tool github_comment_pull_request
 * @description Comenta em um Pull Request por meio da API de comentários de Issue do GitHub.
 * @param {string} owner - Proprietário
 * @param {string} repo - Repositório
 * @param {number} pullNumber - Número do Pull Request
 * @param {string} body - Comentário
 */
export async function commentPullRequest({ owner, repo, pullNumber, body } = {}) {
  const result = await githubRequest(`${repositoryPath(owner, repo)}/issues/${Number(pullNumber)}/comments`, { method: 'POST', body: { body } })
  return { id: result.id, url: result.html_url, createdAt: result.created_at }
}
