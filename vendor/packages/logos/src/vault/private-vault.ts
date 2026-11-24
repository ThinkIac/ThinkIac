// Compatibility only. Private database keys and SQLCipher belong to module-db.
import { externalModulePath } from '../kernel/module-resolution';
import { lazyCapabilityClass } from '../kernel/lazy-capability';
import type * as DB from './private-vault-types';
const implementation = () => require(require('node:path').join(externalModulePath('db'), 'private-vault.cjs')) as typeof DB;
export type { PrivateVaultKeyring, PrivateVaultOptions } from './private-vault-types';
export type PrivateVault = DB.PrivateVault;
export const PrivateVault: typeof DB.PrivateVault = lazyCapabilityClass('db', 'private-vault.cjs', 'PrivateVault');
export type PrivateVaultUnavailableError = DB.PrivateVaultUnavailableError;
export const PrivateVaultUnavailableError: typeof DB.PrivateVaultUnavailableError = lazyCapabilityClass('db', 'private-vault.cjs', 'PrivateVaultUnavailableError');
export const platformKeyring: typeof DB.platformKeyring = (...args) => implementation().platformKeyring(...args);
export const openSqlCipherDatabase: typeof DB.openSqlCipherDatabase = (...args) => implementation().openSqlCipherDatabase(...args);
