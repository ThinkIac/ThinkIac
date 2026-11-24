// Compatibility facade. Schema composition is owned by module-db.
import { externalModulePath } from '../kernel/module-resolution';
interface DB { effectiveSchemaPath(packageDir: string): string; composePackageSchema(packageDir: string): ComposedSchema | null; }
export interface ComposedSchema { schema: string; outputPath: string; sources: string[]; }
const implementation = () => require(require('node:path').join(externalModulePath('db'), 'schema-composer.cjs')) as DB;
export const effectiveSchemaPath: DB['effectiveSchemaPath'] = (...args) => implementation().effectiveSchemaPath(...args);
export const composePackageSchema: DB['composePackageSchema'] = (...args) => implementation().composePackageSchema(...args);
