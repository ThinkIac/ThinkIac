// Compatibility facade. Concrete resources are owned by external modules.
import { legacyModule, lazyLegacyClass } from '../kernel/legacy-module-compat';
import type * as Contract from './contracts/legacy-entry';
export const runLegacyEntry: typeof Contract.runLegacyEntry = (...args: any[]) => legacyModule('modules/legacy-entry').runLegacyEntry(...args);
export const legacyEntryModule: typeof Contract.legacyEntryModule = legacyModule('modules/legacy-entry').legacyEntryModule;
