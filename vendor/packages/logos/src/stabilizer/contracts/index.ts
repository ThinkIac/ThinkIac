import { Container } from '../../kernel/container';
import { CheckpointStore } from './checkpoint';
import { HealthMonitor } from './health';
export declare function findLocalPrismaBinary(cwd?: string): string | null;
export declare class Stabilizer {
    container: Container;
    readonly health: HealthMonitor;
    private closed;
    checkpoints: CheckpointStore;
    private transactions;
    private sourceEvidence;
    private watchers;
    private workspaceWatcher;
    private workspaceWatching;
    private depsFingerprint;
    private installing;
    private newPackageTimers;
    private resolveWorkspaceReady;
    /** Resolve quando o watcher de pacotes novos está de fato observando. */
    readonly workspaceReady: Promise<void>;
    constructor(container: Container);
    enabled(): boolean;
    watchPackage(pkgFolder: string): void;
    watchWorkspace(knownFolders: string[], onNewPackage: (folder: string) => void): void;
    /** Estado seguro para suporte: não expõe paths, código ou segredos. */
    diagnostics(pkgFolder?: string): Record<string, any>;
    stopWatching(pkgFolder: string): void;
    /**
     * Desliga tudo que o stabilizer mantém vivo. Chamado por instance.close().
     *
     * Sem isso os watchers sobrevivem ao runtime que os criou: em um processo com
     * mais de um runtime (testes, um app que reinicializa), o stabilizer órfão
     * continuava reagindo a um workspace que já não existe — inclusive tratando o
     * sumiço dos arquivos como "mudou o package.json" e disparando npm install.
     */
    close(): Promise<void>;
    private onFileChanged;
    commit(pkgFolder: string, trigger: string): Promise<any>;
    private commitUnlocked;
    private onStagingFailed;
    private readManifest;
    private readDepsFingerprint;
    /**
     * Dependências de um pacote RECÉM-CRIADO. O caminho normal (maybeInstallDeps)
     * compara a impressão digital com a anterior e, num pacote novo, não existe
     * anterior — nada era instalado e o pacote quebrava no primeiro require.
     *
     * Só chama o npm se alguma dependência declarada realmente não estiver
     * resolvível: um npm install de ~20s por pacote novo (a esmagadora maioria só
     * usa o que já está na raiz) tornaria "criou, já funciona" uma promessa vazia.
     */
    ensureDeps(pkgFolder: string): Promise<boolean>;
    /** Global lock — never two npm installs on the same workspace at once. */
    private maybeInstallDeps;
    private runInstall;
    private schemaProtocol;
}
