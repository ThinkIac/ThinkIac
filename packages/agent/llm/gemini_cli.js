
















export const GEMINI = {
  pool:     'gemini-cli',
  provider: 'gemini-cli',

  bin: process.env.AGENT_GEMINI_BIN || 'gemini',

  /** Pasta de estado dentro de um $HOME. */
  homeDirName: '.gemini',

  /**
   * Credencial do login OAuth (`/auth` dentro do CLI). Só a existência é
   * checada — o arquivo nunca é lido, copiado ou devolvido pela API.
   */
  credentialFile: 'oauth_creds.json',

  /** Modelo default do slot — null deixa o próprio CLI decidir. */
  defaultModel: process.env.AGENT_GEMINI_MODEL || null,

  /** Comando de login: o CLI autentica interativamente, no `/auth`. */
  loginCommand: (home) => `HOME=${home} ${process.env.AGENT_GEMINI_BIN || 'gemini'}  # e rode /auth`,

  /** Retomar a sessão mais recente do diretório atual. */
  resumeArgs: (which = 'latest') => ['--resume', String(which)],
}
