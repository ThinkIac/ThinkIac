const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');

// node-pty é um backend Linux opcional. O preset Android inclui a mesma UI do
// Terminal, mas fornece seu PTY pelo pacote android-shell; carregar node-pty no
// topo impediria até o catálogo e as rotas de iniciarem no aparelho.
let linuxPty;
function loadLinuxPty() {
  if (linuxPty) return linuxPty;
  try {
    linuxPty = require('node-pty');
    return linuxPty;
  } catch (error) {
    const unavailable = new Error('PTY Linux indisponível neste Runtime');
    unavailable.code = 'LINUX_PTY_UNAVAILABLE';
    unavailable.cause = error;
    throw unavailable;
  }
}

const DEFAULT_PROFILE = 'default';
const SHELL = process.env.SHELL || '/bin/bash';

// Um perfil é um $HOME isolado. Qualquer CLI que guarde credencial sob $HOME
// (`claude login`, `gh auth login`, ollama…) passa a ter uma identidade própria
// e persistente por perfil, sem precisar de suporte da ferramenta.
const PROFILES_DIR = path.join(__dirname, 'profiles');

// Apagar um perfil é apagar um $HOME inteiro (logins de CLI, chaves, histórico) e
// não há como desfazer um `rm -rf`. Em vez disso o diretório é movido para cá: some
// da lista (o ponto no nome não passa por PROFILE_NAME) mas continua no disco para
// um resgate manual. Limpeza é decisão explícita de quem administra a máquina.
const TRASH_DIR = path.join(PROFILES_DIR, '.trash');

// profileId vem do cliente e vira caminho de diretório: recusa qualquer coisa
// com separador ou `..`, que escaparia de PROFILES_DIR.
const PROFILE_NAME = /^[a-zA-Z0-9_-]{1,40}$/;

// O hub WebSocket do logos é criado com `{ server: httpServer }`, ou seja engancha
// direto no evento `upgrade` e nunca passa pelo accessGate do Express — o canal
// chega aqui anônimo. Estes tokens são emitidos só por `GET /terminal/token`, que
// é uma rota HTTP normal e portanto passa pelo accessGate (admin-only). Sem esse
// handshake, /ws seria um shell root aberto para qualquer um que alcance o host.
const TOKEN_TTL_MS = 60_000;
const tokens = new Map(); // token -> expiresAt

// Uma reconexão (tela bloqueada, troca de Wi-Fi para 4G) não pode matar o `nano`
// que estava aberto, então o PTY sobrevive à queda do socket por este tempo.
// Curto de propósito: cada PTY costuma segurar um `claude` inteiro (~300 MB); uma
// janela longa só empilha CLIs mortos comendo RAM enquanto o cliente reconecta —
// e reconexões reais levam segundos, não minutos.
const GRACE_MS = Number(process.env.TERMINAL_GRACE_MS) || 45_000;

// Cada sessão é um `bash -l` que normalmente sobe um `claude` (centenas de MB e
// vários worker threads). Sem teto, abrir/reabrir abas empilha CLIs pesados e
// estoura a RAM da máquina. O limite é por owner (== sessionId do WS do cliente).
const MAX_SESSIONS_PER_OWNER = Number(process.env.TERMINAL_MAX_SESSIONS) || 6;

const sessions = new Map(); // ptyId -> { pty, profileId, owner, onData, onExit, reapTimer }

function issueToken() {
  const now = Date.now();
  for (const [t, expiresAt] of tokens) if (expiresAt <= now) tokens.delete(t);
  const token = crypto.randomBytes(32).toString('hex');
  tokens.set(token, now + TOKEN_TTL_MS);
  return token;
}

function consumeToken(token) {
  if (typeof token !== 'string') return false;
  const expiresAt = tokens.get(token);
  if (expiresAt === undefined) return false;
  tokens.delete(token);
  return Date.now() < expiresAt;
}

function profileHome(profileId) {
  if (!PROFILE_NAME.test(profileId)) throw new Error(`perfil inválido: ${profileId}`);
  const home = path.join(PROFILES_DIR, profileId);
  fs.mkdirSync(home, { recursive: true });
  return home;
}

function listProfiles() {
  try {
    const names = fs
      .readdirSync(PROFILES_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && PROFILE_NAME.test(d.name))
      .map(d => d.name);
    return [...new Set([DEFAULT_PROFILE, ...names.sort()])];
  } catch {
    return [DEFAULT_PROFILE];
  }
}

// ── CRUD de perfis ─────────────────────────────────────────────────────────
// Um perfil é literalmente um diretório sob PROFILES_DIR, então criar/renomear/
// apagar é mexer em diretório — daí a validação estrita do nome (que também é o
// que impede escapar de PROFILES_DIR) e a recusa em tocar num perfil com sessão
// viva: renomear o $HOME debaixo de um shell em execução deixaria o processo
// apontando para um caminho que não existe mais.

function assertProfileName(name) {
  const value = String(name || '').trim();
  if (!PROFILE_NAME.test(value)) {
    throw new Error('nome inválido — use letras, números, hífen ou _ (até 40 caracteres)');
  }
  return value;
}

function profilesInUse() {
  const inUse = new Set();
  for (const session of sessions.values()) if (session.profileId) inUse.add(session.profileId);
  return inUse;
}

function assertProfileFree(name) {
  if (profilesInUse().has(name)) {
    throw new Error(`o perfil "${name}" tem sessão aberta — feche as abas que o usam antes`);
  }
}

function createProfile(name) {
  const profileId = assertProfileName(name);
  const home = path.join(PROFILES_DIR, profileId);
  if (fs.existsSync(home)) throw new Error(`o perfil "${profileId}" já existe`);
  fs.mkdirSync(home, { recursive: true });
  return { profileId, profiles: listProfiles() };
}

function renameProfile(from, to) {
  const source = assertProfileName(from);
  const target = assertProfileName(to);
  if (source === DEFAULT_PROFILE) throw new Error('o perfil "default" não pode ser renomeado');
  if (source === target) return { profileId: target, profiles: listProfiles() };
  const sourceHome = path.join(PROFILES_DIR, source);
  const targetHome = path.join(PROFILES_DIR, target);
  if (!fs.existsSync(sourceHome)) throw new Error(`o perfil "${source}" não existe`);
  if (fs.existsSync(targetHome)) throw new Error(`o perfil "${target}" já existe`);
  assertProfileFree(source);
  fs.renameSync(sourceHome, targetHome);
  return { profileId: target, profiles: listProfiles() };
}

function deleteProfile(name) {
  const profileId = assertProfileName(name);
  if (profileId === DEFAULT_PROFILE) throw new Error('o perfil "default" não pode ser apagado');
  const home = path.join(PROFILES_DIR, profileId);
  if (!fs.existsSync(home)) throw new Error(`o perfil "${profileId}" não existe`);
  assertProfileFree(profileId);
  fs.mkdirSync(TRASH_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const trashed = path.join(TRASH_DIR, `${profileId}-${stamp}`);
  fs.renameSync(home, trashed);
  return { profileId, trashed, profiles: listProfiles() };
}

function profileEnv(home) {
  const env = { ...process.env, HOME: home, TERM: 'xterm-256color' };
  // Herdados do processo do Aurora, os XDG_* apontariam para o $HOME dele e
  // furariam o isolamento (o `gh`, por exemplo, grava em $XDG_CONFIG_HOME/gh).
  // Removidos, cada ferramenta volta ao default relativo a $HOME.
  for (const key of Object.keys(env)) if (key.startsWith('XDG_')) delete env[key];
  // CODEX_HOME, se herdado do processo Aurora, teria precedência sobre HOME e
  // faria todos os perfis compartilharem o mesmo login Codex. O default do
  // CLI volta então a ser <HOME>/.codex, isolado por perfil.
  delete env.CODEX_HOME;
  return env;
}

// Tamanho máximo do comando inicial injetado (deeplink de sessão). Serve só de
// guarda-chuva de sanidade — o PTY é um shell root admin-only, então não há
// escalada nova aqui; é o mesmo poder de quem já digita no terminal.
const MAX_INIT_COMMAND = 4096;
const INLINE_TIMEOUT_MS = 30_000;
const INLINE_MAX_OUTPUT = 64 * 1024;
const INLINE_MAX_COMMAND = 16 * 1024;

function inlineCommandNeedsConfirmation(command) {
  return /(^|[;&|\n]\s*)(sudo\b|su\b|doas\b|rm\s+-[^\n]*r|dd\b|mkfs\b|shutdown\b|reboot\b|poweroff\b|halt\b|chmod\s+-R|chown\s+-R|git\s+reset\s+--hard|git\s+clean\s+-[a-z]*f|apt(?:-get)?\s+(?:install|remove|purge|upgrade|dist-upgrade)\b|(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|update|upgrade)\b|pip(?:3)?\s+install\b|cargo\s+install\b)/im.test(command);
}

function appendInlineOutput(current, chunk) {
  if (current.length >= INLINE_MAX_OUTPUT) return current;
  return current + chunk.slice(0, INLINE_MAX_OUTPUT - current.length);
}

// Por padrão herda o ambiente real do Runtime para suportar instalações.
// `isolated` troca HOME/XDG por um diretório temporário, limpo ao terminar.
function executeInline({ command, isolated = false, confirmed = false } = {}) {
  if (typeof command !== 'string' || !command.trim()) return Promise.reject(new Error('comando bash obrigatório'));
  if (command.length > INLINE_MAX_COMMAND) return Promise.reject(new Error(`comando excede ${INLINE_MAX_COMMAND} caracteres`));
  if (inlineCommandNeedsConfirmation(command) && !confirmed) {
    const error = new Error('este comando requer confirmação explícita');
    error.code = 'CONFIRMATION_REQUIRED';
    return Promise.reject(error);
  }
  return new Promise((resolve, reject) => {
    let tempHome = null, timedOut = false, stdout = '', stderr = '', settled = false;
    try {
      const options = { cwd: process.cwd(), env: { ...process.env } };
      if (isolated) {
        tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'thinkiac-inline-'));
        options.cwd = tempHome;
        options.env = profileEnv(tempHome);
      }
      const child = spawn(SHELL, ['-lc', command], options);
      let timer;
      const cleanup = () => { clearTimeout(timer); if (tempHome) fs.rmSync(tempHome, { recursive: true, force: true }); };
      child.stdout.on('data', data => { stdout = appendInlineOutput(stdout, String(data)); });
      child.stderr.on('data', data => { stderr = appendInlineOutput(stderr, String(data)); });
      child.on('error', err => { if (!settled) { settled = true; cleanup(); reject(err); } });
      child.on('close', (exitCode, signal) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ stdout, stderr, exitCode: timedOut ? 124 : (exitCode ?? 1), signal, timedOut, truncated: stdout.length >= INLINE_MAX_OUTPUT || stderr.length >= INLINE_MAX_OUTPUT });
      });
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 1_500).unref();
      }, INLINE_TIMEOUT_MS);
    } catch (err) {
      if (tempHome) fs.rmSync(tempHome, { recursive: true, force: true });
      reject(err);
    }
  });
}

function startPty({ ptyId, cols, rows, profileId, owner, onData, onExit, initCommand }) {
  const existing = sessions.get(ptyId);
  if (existing) {
    // Reconexão: o processo continua vivo, só troca o socket que recebe a saída.
    if (existing.owner !== owner) throw new Error('sessão pertence a outro cliente');
    if (existing.reapTimer) {
      clearTimeout(existing.reapTimer);
      existing.reapTimer = null;
    }
    existing.onData = onData;
    existing.onExit = onExit;
    resizePty(ptyId, cols, rows);
    return existing;
  }

  // Sessão nova (não é reconexão): respeita o teto por owner antes de gastar RAM
  // com mais um shell/CLI. Só contam sessões vivas — as marcadas para reap ainda
  // ocupam memória, então também entram na conta.
  let ownerCount = 0;
  for (const s of sessions.values()) if (s.owner === owner) ownerCount++;
  if (ownerCount >= MAX_SESSIONS_PER_OWNER) {
    throw new Error(`limite de ${MAX_SESSIONS_PER_OWNER} sessões atingido — feche uma aba antes de abrir outra`);
  }

  const home = profileHome(profileId || DEFAULT_PROFILE);
  const proc = loadLinuxPty().spawn(SHELL, ['-l'], {
    name: 'xterm-256color',
    cols: cols || 80,
    rows: rows || 24,
    cwd: home,
    env: profileEnv(home),
  });

  const session = {
    pty: proc,
    profileId: profileId || DEFAULT_PROFILE,
    owner,
    onData,
    onExit,
    reapTimer: null,
  };
  sessions.set(ptyId, session);

  proc.onData(data => session.onData?.(data));
  proc.onExit(({ exitCode }) => {
    if (session.reapTimer) clearTimeout(session.reapTimer);
    // Um kill seguido de start reutiliza o mesmo ptyId. O processo antigo pode
    // reportar sua saída depois que a nova sessão já entrou no mapa; nesse caso,
    // não pode apagar nem notificar a sessão nova.
    if (sessions.get(ptyId) !== session) return;
    sessions.delete(ptyId);
    session.onExit?.(exitCode);
  });

  // Deeplink de sessão do Claude (widget "Sessões Claude"): roda um comando
  // logo após subir o shell — tipicamente `cd <cwd> && claude --resume <uuid>`.
  // Só na criação (nunca na reconexão), depois de uma folga pro `bash -l`
  // terminar de sourcear o profile e imprimir o prompt, senão o comando pode
  // ser engolido/ecoado no meio da inicialização.
  if (typeof initCommand === 'string' && initCommand.trim() && initCommand.length <= MAX_INIT_COMMAND) {
    const cmd = initCommand.endsWith('\n') ? initCommand : `${initCommand}\n`;
    setTimeout(() => {
      try { proc.write(cmd); } catch {}
    }, 400);
  }

  return session;
}

function writePty(ptyId, data, owner) {
  const session = sessions.get(ptyId);
  if (!session || session.owner !== owner) return;
  session.pty.write(data);
}

function resizePty(ptyId, cols, rows) {
  const session = sessions.get(ptyId);
  if (!session || !cols || !rows) return;
  try {
    session.pty.resize(cols, rows);
  } catch {}
}

function killPty(ptyId, owner) {
  const session = sessions.get(ptyId);
  if (!session) return;
  if (owner !== undefined && session.owner !== owner) return;
  if (session.reapTimer) clearTimeout(session.reapTimer);
  sessions.delete(ptyId);
  try {
    session.pty.kill();
  } catch {}
}

// Socket caiu: solta os callbacks (o `ws` morto não deve receber escrita) e marca
// os PTYs para morrer se o cliente não voltar dentro da janela de graça.
function detachOwner(owner) {
  for (const [ptyId, session] of sessions) {
    if (session.owner !== owner || session.reapTimer) continue;
    session.onData = null;
    session.onExit = null;
    session.reapTimer = setTimeout(() => killPty(ptyId), GRACE_MS);
  }
}

module.exports = {
  issueToken,
  consumeToken,
  listProfiles,
  startPty,
  writePty,
  resizePty,
  killPty,
  detachOwner,
  executeInline,
  inlineCommandNeedsConfirmation,
  createProfile,
  renameProfile,
  deleteProfile,
  profilesInUse,
};
