// Dependency preparation is available before module installation. It acquires no
// watchers or health monitors and preserves the same installation queue on reload.
module.exports = function (require, module, exports) {
const fs_1 = { default: require('node:fs') };
const path_1 = { default: require('node:path') };
const node_module_1 = require('node:module');
const child_process_1 = require('node:child_process');
class DependencyInstaller {
    constructor(container) {
        this.container = container;
        this.depsFingerprint = new Map();
        this.installing = null;
    }
    readManifest(pkgFolder) {
        try {
            return JSON.parse(fs_1.default.readFileSync(path_1.default.join(this.container.workspace, pkgFolder, 'package.json'), 'utf-8'));
        }
        catch {
            return null;
        }
    }
    readDepsFingerprint(pkgFolder) {
        const manifest = this.readManifest(pkgFolder);
        if (!manifest)
            return '';
        return JSON.stringify({ ...manifest.dependencies, ...manifest.devDependencies });
    }
    /**
     * Dependências de um pacote RECÉM-CRIADO. O caminho normal (maybeInstallDeps)
     * compara a impressão digital com a anterior e, num pacote novo, não existe
     * anterior — nada era instalado e o pacote quebrava no primeiro require.
     *
     * Só chama o npm se alguma dependência declarada realmente não estiver
     * resolvível: um npm install de ~20s por pacote novo (a esmagadora maioria só
     * usa o que já está na raiz) tornaria "criou, já funciona" uma promessa vazia.
     */
    async ensureDeps(pkgFolder) {
        const manifest = this.readManifest(pkgFolder);
        if (!manifest)
            return false;
        const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
        const required = process.env.NODE_ENV === 'production' ? manifest.dependencies ?? {} : dependencies;
        const manifestPath = path_1.default.resolve(this.container.workspace, pkgFolder, 'package.json');
        const lookup = (0, node_module_1.createRequire)(manifestPath).resolve;
        // Check package presence without assuming it exports a CommonJS entrypoint.
        const missing = Object.keys(required).filter(dep => {
            const directories = lookup.paths(dep) ?? [];
            return !directories.some(directory => fs_1.default.existsSync(path_1.default.join(directory, dep, 'package.json')));
        });
        if (missing.length) {
            this.container.log(`[stabilizer:deps] "${pkgFolder}" needs ${missing.join(', ')}`);
            await this.runInstall(pkgFolder);
        }
        this.depsFingerprint.set(pkgFolder, JSON.stringify(dependencies));
        return missing.length > 0;
    }
    /** Global lock — never two npm installs on the same workspace at once. */
    async maybeInstallDeps(pkgFolder) {
        const current = this.readDepsFingerprint(pkgFolder);
        const previous = this.depsFingerprint.get(pkgFolder);
        if (previous === undefined || previous === current)
            return;
        // Manifesto ilegível ou apagado (pacote removido, checkout no meio do
        // caminho): instalar não conserta nada e um npm install acidental na raiz
        // mexe no node_modules de todo mundo.
        if (current === '')
            return;
        await this.runInstall(pkgFolder);
        this.depsFingerprint.set(pkgFolder, current);
    }
    async runInstall(pkgFolder) {
        const previous = this.installing ?? Promise.resolve();
        const install = previous.catch(() => undefined).then(() => new Promise((resolve, reject) => {
            const directory = path_1.default.resolve(this.container.workspace, pkgFolder);
            this.container.log(`[stabilizer:deps] installing dependencies for "${pkgFolder}"`);
            // Installing dependencies must leave the source candidate and its lockfile intact.
            const args = ['--prefix', '.', 'install', '--workspaces=false', '--legacy-peer-deps', '--no-save'];
            const child = (0, child_process_1.spawn)('npm', args, {
                cwd: directory,
                stdio: 'inherit',
                shell: process.platform === 'win32',
            });
            child.once('error', reject);
            child.once('close', (code, signal) => {
                if (code === 0)
                    resolve();
                else
                    reject(new Error(`npm install failed for "${pkgFolder}" (${signal ?? code})`));
            });
        }));
        this.installing = install;
        try {
            await install;
        }
        finally {
            if (this.installing === install)
                this.installing = null;
        }
    }
}
exports.DependencyInstaller = DependencyInstaller;
};
