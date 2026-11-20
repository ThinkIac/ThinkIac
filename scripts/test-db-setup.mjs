import { createRequire } from 'node:module';
import { getDefaultContainer } from 'logos';

const require = createRequire(import.meta.url);
const logosRequire = createRequire(require.resolve('logos/package.json'));
const { installExternalModules } = logosRequire('./dist/src/kernel/external-modules.js');
const container = getDefaultContainer();
installExternalModules(container, ['db']);
await container.installPhase('boot');
