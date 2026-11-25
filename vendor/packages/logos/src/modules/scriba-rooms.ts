// Compatibility facade. Concrete resources are owned by external modules.
import { legacyModule, lazyLegacyClass } from '../kernel/legacy-module-compat';
import type * as Contract from './contracts/scriba-rooms';
export type ScribaRooms = Contract.ScribaRooms;
export const ScribaRooms: typeof Contract.ScribaRooms = lazyLegacyClass('modules/scriba-rooms', 'ScribaRooms');
