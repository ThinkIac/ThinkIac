import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { validateProfile } from './profile.mjs';

const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const save = (file, data) => fs.writeFile(file, data, { mode: 0o600 });
const flags = new Map([
  ['--name', 'name'], ['--profile', 'profile'], ['--port', 'port'],
  ['--mcp-port', 'mcpPort'], ['--admin-email', 'email'],
]);

export function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help' || flag === '-h') options.help = true;
    else if (flag === '--install-only') options.installOnly = true;
    else {
      const key = flags.get(flag);
      const value = args[++i];
      if (!key || !value || value.startsWith('--') || key in options) throw new Error(`Opção inválida: ${flag}`);
      options[key] = value;
    }
  }
  return options;
}

function validPort(value) {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error(`Porta inválida: ${value}`);
  }
  return Number(value);
}

export async function configureInstance({ cwd, base, input = process.stdin, output = process.stdout, ...options }) {
  const home = path.join(cwd, '.thinkiac');
  const instanceFile = path.join(home, 'instance.json');
  const profileFile = path.join(home, 'profile.json');
  const existing = await readJson(instanceFile).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (existing) {
    if ([...flags.values()].some(key => options[key] !== undefined)) {
      throw new Error('A instância já existe. Execute sem opções de configuração para iniciá-la.');
    }
    if (existing.version !== 1) throw new Error('Versão de instância incompatível');
    return { home, config: existing, profileFile };
  }

  const interactive = input.isTTY && output.isTTY;
  if (!interactive && !options.name) throw new Error('Use --name para criar uma instância sem terminal interativo');
  const prompt = interactive ? createInterface({ input, output }) : null;
  const cancelled = new AbortController();
  prompt?.once('SIGINT', () => cancelled.abort());
  prompt?.once('close', () => cancelled.abort());
  const ask = async (key, label, fallback) => options[key] ?? (
    prompt ? (await prompt.question(`${label} [${fallback}]: `, { signal: cancelled.signal })).trim() || fallback : fallback
  );

  let config, profile, lock, email;
  try {
    const name = await ask('name', 'Nome da instância', path.basename(cwd) || 'thinkiac');
    if (!name.trim() || /[\x00-\x1f\x7f]/.test(name)) throw new Error('Nome de instância inválido');
    const selection = await ask('profile', 'Perfil (default ou caminho de um JSON)', 'default');
    const source = selection === 'default' ? path.join(base, 'profiles/default.json') : path.resolve(cwd, selection);
    if (!source.endsWith('.json')) throw new Error('O perfil precisa ser um arquivo JSON');
    profile = await readJson(source);
    lock = await readJson(source.replace(/\.json$/, '.lock.json'));
    validateProfile(profile, lock);
    const port = validPort(await ask('port', 'Porta HTTP', '5040'));
    const mcpPort = validPort(await ask('mcpPort', 'Porta MCP', '3333'));
    if (port === mcpPort) throw new Error('HTTP e MCP precisam de portas distintas');
    config = { version: 1, name, profile: profile.name, port, mcpPort };
    if (Object.hasOwn(profile.dependencies, 'auth')) {
      email = await ask('email', 'E-mail do administrador', 'admin@thinkiac.local');
      if (!/^[\w.+-]+@[\w.-]+\.[\w-]+$/.test(email)) throw new Error('E-mail de administrador inválido');
    }
  } finally {
    prompt?.close();
  }

  const stage = await fs.mkdtemp(path.join(cwd, '.thinkiac-setup-'));
  const password = email ? randomBytes(24).toString('base64url') : null;
  try {
    await save(path.join(stage, '.gitignore'), '*\n');
    await save(path.join(stage, 'profile.json'), JSON.stringify(profile, null, 2) + '\n');
    await save(path.join(stage, 'profile.lock.json'), JSON.stringify(lock, null, 2) + '\n');
    await save(path.join(stage, '.env'), email
      ? `INITIAL_AUTH_USER=admin\nINITIAL_AUTH_EMAIL=${email}\nINITIAL_AUTH_PASSWORD=${password}\n` : '');
    await save(path.join(stage, 'instance.json'), JSON.stringify(config, null, 2) + '\n');
    await fs.rename(stage, home);
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
  output.write(`Instância ${config.name} configurada em ${home}\n`);
  if (email) {
    output.write(`Administrador: ${email}. Credencial inicial em ${path.join(home, '.env')}\n`);
    if (interactive) output.write(`Senha inicial: ${password}\n`);
  }
  return { home, config, profileFile };
}
