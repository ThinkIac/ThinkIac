// Compatibility facade. Concrete resources are owned by external modules.
import { legacyModule, lazyLegacyClass } from '../kernel/legacy-module-compat';
import type * as Contract from './contracts/storage-s3';
export type { S3StorageOptions } from './contracts/storage-s3';
export type S3StorageProvider = Contract.S3StorageProvider;
export const S3StorageProvider: typeof Contract.S3StorageProvider = lazyLegacyClass('modules/storage-s3', 'S3StorageProvider');
