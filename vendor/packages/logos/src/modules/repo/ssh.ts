// Compatibility facade. Concrete resources are owned by external modules.
import { legacyModule, lazyLegacyClass } from '../../kernel/legacy-module-compat';
import type * as Contract from '../contracts/repo/ssh';
export type { SshServerOptions, SshServerHandle } from '../contracts/repo/ssh';
export const parseGitCommand: typeof Contract.parseGitCommand = (...args: any[]) => legacyModule('modules/repo/ssh').parseGitCommand(...args);
export const startSshServer: typeof Contract.startSshServer = (...args: any[]) => legacyModule('modules/repo/ssh').startSshServer(...args);
