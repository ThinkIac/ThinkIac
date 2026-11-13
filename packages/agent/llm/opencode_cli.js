import { join } from 'path'

export const OPENCODE = {
  pool:     'opencode-cli',
  provider: 'opencode-cli',

  bin: process.env.AGENT_OPENCODE_BIN || 'opencode',

  homeEnv: 'HOME',

  homeDirName: '.config',

  dataDir: join('.local', 'share', 'opencode'),

  credentialFile: 'auth.json',

  defaultModel: process.env.AGENT_OPENCODE_MODEL || null,

  execArgs: ['run'],

  loginArgs: ['providers', 'login', '--help'],
}

export function opencodeLoginCommand(home) {
  return `HOME=${home} ${OPENCODE.bin} providers login`
}