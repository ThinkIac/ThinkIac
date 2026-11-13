
















export const ANTIGRAVITY = {
  /** Nome do pool/provider "modo cli" no agent.config.json. */
  pool:     'antigravity-cli',
  provider: 'antigravity-cli',

  /** Binário do CLI. */
  bin: process.env.AGENT_ANTIGRAVITY_BIN || 'antigravity',

  /** Env var que aponta o diretório de estado da conta. */
  homeEnv: process.env.AGENT_ANTIGRAVITY_HOME_ENV || 'ANTIGRAVITY_HOME',

  /** Nome da pasta de estado dentro de um $HOME (perfil do Terminal). */
  homeDirName: process.env.AGENT_ANTIGRAVITY_DIR || '.antigravity',

  /** Arquivo cuja simples existência indica "login feito". Conteúdo nunca é lido. */
  credentialFile: process.env.AGENT_ANTIGRAVITY_CRED || 'auth.json',

  /** Subpasta com os rollouts de sessão (JSONL). */
  sessionsDirName: process.env.AGENT_ANTIGRAVITY_SESSIONS || 'sessions',

  /** Modelo default do slot — null deixa o próprio CLI decidir. */
  defaultModel: process.env.AGENT_ANTIGRAVITY_MODEL || null,

  /** Subcomando não-interativo (lê o prompt do stdin). */
  execArgs: ['exec'],

  /** Subcomando de login (usado só pra montar a dica exibida na UI). */
  loginArgs: ['login'],

  /** Como retomar uma sessão existente pelo id. */
  resumeArgs: (id) => ['exec', 'resume', id],

  /** Flag de streaming JSONL, se houver. `null` desliga o caminho de stream. */
  streamFlag: process.env.AGENT_ANTIGRAVITY_STREAM_FLAG || null,
}

/** Comando de login pra exibir na UI de uma conta ainda não autenticada. */
export function antigravityLoginCommand(configDir) {
  return `${ANTIGRAVITY.homeEnv}=${configDir} ${ANTIGRAVITY.bin} ${ANTIGRAVITY.loginArgs.join(' ')}`
}
