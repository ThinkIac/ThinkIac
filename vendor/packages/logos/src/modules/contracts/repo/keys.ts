export type KeyRole = 'main' | 'branch' | 'read';
export interface AuthorizedKey {
    type: string;
    /** Raw public key blob, as sent on the wire. */
    blob: Buffer;
    comment: string;
    role: KeyRole;
}
export declare function parseAuthorizedKeys(content: string): AuthorizedKey[];
export declare function loadAuthorizedKeys(file: string): AuthorizedKey[];
export declare function appendAuthorizedKey(file: string, line: string, role?: KeyRole): AuthorizedKey | null;
