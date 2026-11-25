// Compatibility facade. Concrete resources are owned by external modules.
import { legacyModule, lazyLegacyClass } from '../kernel/legacy-module-compat';
import type * as Contract from './contracts/commands';
export const runCommand: typeof Contract.runCommand = (...args: any[]) => legacyModule('modules/commands').runCommand(...args);
export const commandsModule: typeof Contract.commandsModule = legacyModule('modules/commands').commandsModule;
