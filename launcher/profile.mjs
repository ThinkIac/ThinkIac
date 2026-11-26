import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';

const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const writeJson = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');
const exists = async file => !!(await fs.stat(file).catch(() => null));
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

export function parseSource(source) {
  const match = /^(?:github:)?([\w.-]+)\/([\w.-]+)#([^\s~^:?*\[\\]+)$/.exec(source);
  if (!match || match[3].startsWith('-') || match[3].includes('..') || match[3].includes('@{'))
    throw new Error(`Referência Git inválida: ${source}. Use owner/repository#main ou #1.0.0`);
  return { repository: `${match[1]}/${match[2]}`, revision: match[3] };
}

export function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\')) throw new Error('Caminho de pacote inválido');
  const target = path.resolve(root, relative);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error(`Caminho fora da instalação: ${relative}`);
  return target;
}

export async function command(program, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, stdio: 'inherit', env: process.env });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${program} terminou com código ${code}`)));
  });
}

async function gitPackage({ source, commit, destination }) {
  const { repository, revision } = parseSource(source);
  await fs.mkdir(destination, { recursive: true });
  // Git uses host credential helpers. No credentials are copied into profiles or locks.
  await command('git', ['init', '--quiet', destination], path.dirname(destination));
  await command('git', ['remote', 'add', 'origin', `https://github.com/${repository}.git`], destination);
  await command('git', ['fetch', '--quiet', '--depth=1', 'origin', commit || revision], destination);
  const hash = await new Promise((resolve, reject) => execFile('git', ['rev-parse', 'FETCH_HEAD'], { cwd: destination }, (error, stdout) => error ? reject(error) : resolve(stdout.trim())));
  if (!/^[a-f0-9]{40}$/.test(hash) || (commit && hash !== commit)) throw new Error('Commit recebido diverge do lockfile');
  await command('git', ['checkout', '--quiet', '--detach', hash], destination);
  await fs.rm(path.join(destination, '.git'), { recursive: true, force: true });
  return hash;
}

export function validateProfile(profile, lock, update = false) {
  if (profile.version !== 1 || !/^[\w-]+$/.test(profile.name) || !profile.dependencies || Array.isArray(profile.dependencies)) throw new Error('Perfil inválido');
  const occupied = ['/installation/vendor/packages/logos'];
  for (const [name, source] of Object.entries(profile.dependencies)) {
    if (!/^(?:@[\w.-]+\/)?[\w.-]+$/.test(name) || name === 'logos') throw new Error(`Identidade inválida ou reservada: ${name}`);
    parseSource(source);
    const target = inside('/installation', profile.paths?.[name] || `packages/${name}`);
    if (occupied.includes(target) || target.startsWith('/installation/vendor/packages/logos/')) throw new Error('Caminhos de pacotes sobrepostos');
    occupied.push(target);
    if (!update && (lock?.version !== 1 || lock.dependencies?.[name]?.source !== source || !/^[a-f0-9]{40}$/.test(lock.dependencies[name].commit))) throw new Error(`Lock ausente ou desatualizado para ${name}; execute profile:update`);
  }
  for (const [name, source] of Object.entries(profile.npmDependencies || {})) {
    if (name === 'logos' || name in profile.dependencies || /^(file:|link:|workspace:)/.test(source)) throw new Error(`Dependência npm inválida: ${name}`);
  }
}

/** A new generation is published only after all downloads, builds and linking succeed. */
export async function installProfile({ base, profileFile, update = false, fetchPackage = gitPackage, installNpm = true }) {
  const profile = await json(profileFile);
  const lockFile = profileFile.replace(/\.json$/, '.lock.json');
  const lock = await json(lockFile).catch(() => null);
  validateProfile(profile, lock, update);
  const home = path.resolve(process.env.THINKIAC_HOME || path.join(base, '.thinkiac'));
  const root = path.join(home, profile.name);
  await fs.mkdir(root, { recursive: true });
  const guard = path.join(root, 'install.lock');
  let handle;
  try { handle = await fs.open(guard, 'wx'); }
  catch { throw new Error(`Instalação concorrente ou interrompida: ${guard}. Verifique o processo antes de remover esse lock.`); }
  const stage = path.join(root, 'generations', randomUUID());
  try {
    const hash = createHash('sha256');
    async function hashTree(dir) {
      for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await hashTree(file);
        else if (entry.isFile()) hash.update(file.slice(base.length)).update(await fs.readFile(file));
      }
    }
    for (const dir of ['vendor/packages/logos/dist', 'lib', 'public']) await hashTree(path.join(base, dir));
    for (const file of ['launcher/runtime.js', 'launcher/profile.mjs', 'vendor/packages/logos/package.json', 'logos.supervisor.json', 'agent.config.default.json']) hash.update(await fs.readFile(path.join(base, file)));
    const kernel = hash.digest('hex');
    const fingerprintFor = resolved => createHash('sha256').update(stable({ profile, lock: resolved, kernel })).digest('hex');
    const fingerprint = fingerprintFor(lock);
    const current = await json(path.join(root, 'current.json')).catch(() => null);
    if (!update && current?.fingerprint === fingerprint && await exists(path.join(current.directory, 'installation.json'))) return { ...current, profile, home };
    await fs.mkdir(path.join(stage, 'packages'), { recursive: true });
    const manifests = new Map();
    const resolved = { version: 1, dependencies: {} };
    const paths = {};
    const ordered = Object.entries(profile.dependencies).sort(([a], [b]) =>
      (profile.paths?.[a] || `packages/${a}`).split('/').length - (profile.paths?.[b] || `packages/${b}`).split('/').length);
    for (const [name, source] of ordered) {
      const relative = profile.paths?.[name] || `packages/${name}`;
      const destination = inside(stage, relative);
      if (await exists(destination)) {
        const embedded = await json(path.join(destination, 'package.json'));
        if (embedded.name !== name) throw new Error(`Pacote aninhado conflitante: ${relative}`);
        await fs.rm(destination, { recursive: true });
      }
      console.log(`[profile:${profile.name}] ${source}`);
      const commit = await fetchPackage({ source, commit: update ? null : lock.dependencies[name].commit, destination });
      if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error(`Commit inválido: ${name}`);
      const manifest = await json(path.join(destination, 'package.json'));
      if (manifest.name !== name) throw new Error(`${source}: package.name ${manifest.name} difere de ${name}`);
      manifests.set(name, manifest); paths[name] = relative;
      resolved.dependencies[name] = { source, commit };
    }
    const kernelDir = path.join(stage, 'vendor/packages/logos');
    await fs.mkdir(kernelDir, { recursive: true });
    await fs.cp(path.join(base, 'vendor/packages/logos/dist'), path.join(kernelDir, 'dist'), { recursive: true });
    const kernelManifest = await json(path.join(base, 'vendor/packages/logos/package.json'));
    delete kernelManifest.scripts;
    manifests.set('logos', kernelManifest); paths.logos = 'vendor/packages/logos';
    for (const [name, manifest] of manifests) {
      // Resolve selected sibling dependencies inside this composition, never against an old source tree.
      for (const group of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
        for (const [dependency, spec] of Object.entries(manifest[group] || {})) {
          if (manifests.has(dependency)) manifest[group][dependency] = '*';
          else if (/^(file:|link:|workspace:)/.test(spec)) throw new Error(`${name}: dependência local não selecionada: ${dependency}`);
        }
      }
      delete manifest.devDependencies;
      await writeJson(path.join(stage, paths[name], 'package.json'), manifest);
    }
    for (const dir of ['lib', 'public']) await fs.cp(path.join(base, dir), path.join(stage, dir), { recursive: true });
    await fs.copyFile(path.join(base, 'launcher/runtime.js'), path.join(stage, 'index.js'));
    for (const file of ['logos.supervisor.json', 'agent.config.default.json']) await fs.copyFile(path.join(base, file), path.join(stage, file));
    await writeJson(path.join(stage, 'runtime-profile.json'), { config: profile.config || {} });
    await writeJson(path.join(stage, 'package.json'), { name: 'thinkiac-profile-installation', private: true, type: 'module', workspaces: Object.values(paths), dependencies: profile.npmDependencies || {}, overrides: profile.overrides || {}, logos: { cli: { supervisor: './vendor/packages/modules/supervisor/cli.cjs' } } });
    if (installNpm) {
      await command(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--include=dev', '--legacy-peer-deps', '--no-audit', '--no-fund'], stage);
      for (const [dependency, source, target] of [
        ['@xterm/xterm', 'lib/xterm.js', 'xterm.js'],
        ['@xterm/xterm', 'css/xterm.css', 'xterm.css'],
        ['@xterm/addon-fit', 'lib/addon-fit.js', 'addon-fit.js'],
      ]) {
        if (!profile.npmDependencies?.[dependency]) continue;
        const assets = path.join(stage, 'public/vendor/xterm');
        await fs.mkdir(assets, { recursive: true });
        await fs.copyFile(path.join(stage, 'node_modules', dependency, source), path.join(assets, target));
      }
    }
    await fs.mkdir(path.join(root, 'state'), { recursive: true });
    for (const entry of ['.logos', 'uploads']) {
      const target = path.join(root, 'state', entry);
      await fs.mkdir(target, { recursive: true });
      await fs.symlink(target, path.join(stage, entry), process.platform === 'win32' ? 'junction' : 'dir');
    }
    for (const [name, relative] of Object.entries(paths)) {
      if (!relative.startsWith('packages/')) continue;
      const packageState = path.join(root, 'state/packages', name);
      await fs.mkdir(packageState, { recursive: true });
      for (const entry of ['.private', '.database', 'data', 'uploads', 'profiles', 'shared-cache']) {
        const link = path.join(stage, relative, entry);
        const target = path.join(packageState, entry);
        if (await exists(link)) continue; // Never replace versioned repository assets.
        await fs.mkdir(target, { recursive: true });
        await fs.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
      }
    }
    const result = { directory: stage, fingerprint: fingerprintFor(resolved) };
    await writeJson(path.join(stage, 'profile.lock.json'), resolved);
    await writeJson(path.join(stage, 'installation.json'), result);
    if (update) { await writeJson(lockFile + '.tmp', resolved); await fs.rename(lockFile + '.tmp', lockFile); }
    await writeJson(path.join(root, 'current.json.tmp'), result);
    await fs.rename(path.join(root, 'current.json.tmp'), path.join(root, 'current.json'));
    return { ...result, profile, home };
  } catch (error) {
    await fs.rm(stage, { recursive: true, force: true });
    throw error;
  } finally { await handle.close(); await fs.unlink(guard); }
}
