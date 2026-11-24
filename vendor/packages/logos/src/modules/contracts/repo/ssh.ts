import { RepoPaths } from './paths';
import { KeyRole } from './keys';
export interface SshServerOptions {
    paths: RepoPaths;
    port: number;
    host: string;
    banner?: string;
    /** Git Cloud's Ed25519 public key; enables only short-lived delegated sessions. */
    delegationPublicKey?: string;
    /** The paired Machine code; delegated credentials are never reusable elsewhere. */
    machineCode?: string;
    log: (msg: string) => void;
    /** Called after every accepted git command, for bus events. */
    onSession?: (info: {
        role: KeyRole;
        comment: string;
        command: 'upload-pack' | 'receive-pack';
    }) => void;
}
export interface SshServerHandle {
    port: number;
    close(): Promise<void>;
    /** Fingerprint of the host key, to show in the UI. */
    fingerprint: string;
}
export declare function parseGitCommand(command: string): {
    verb: 'upload-pack' | 'receive-pack';
    repo: string;
} | null;
export declare function startSshServer(opts: SshServerOptions): Promise<SshServerHandle | null>;
