// Compatibility facade. Concrete resources are owned by external modules.
import { legacyModule, lazyLegacyClass } from '../kernel/legacy-module-compat';
import type * as Contract from './contracts/storage';
export type { StorageState, StorageRecord, StorageProvider, StorageMeshOptions } from './contracts/storage';
export type StorageUnavailableError = Contract.StorageUnavailableError;
export const StorageUnavailableError: typeof Contract.StorageUnavailableError = lazyLegacyClass('modules/storage', 'StorageUnavailableError');
export type StorageMesh = Contract.StorageMesh;
export const StorageMesh: typeof Contract.StorageMesh = lazyLegacyClass('modules/storage', 'StorageMesh');
export const getStorage: typeof Contract.getStorage = (...args: any[]) => legacyModule('modules/storage').getStorage(...args);
export const storageModule: typeof Contract.storageModule = legacyModule('modules/storage').storageModule;
