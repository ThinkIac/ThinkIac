import { KeyRole } from './keys';
export declare const DELEGATION_PREFIX = "logos-delegated-v1.";
export interface DelegatedIdentity {
    machine: string;
    actor: string;
    role: KeyRole;
    exp: number;
}
/** Validates the compact identity issued by Git Cloud for a single SSH session. */
export declare function verifyDelegatedCredential(username: string, publicKey: string, expectedMachine?: string, now?: () => number): DelegatedIdentity | null;
