// Build-time worker: CSS scanning/optimization must not occupy the HTTP thread.
const { parentPort, workerData } = require('node:worker_threads');
const path = require('node:path');
(async () => {
    const pluginPath = workerData.pluginPath;
    const postcss = require(require.resolve('postcss', { paths: [path.dirname(pluginPath)] }));
    const tailwind = require(pluginPath);
    const cssPath = require.resolve('tailwindcss/index.css', { paths: [path.dirname(pluginPath)] });
    const quote = value => JSON.stringify(value.replaceAll('\\', '/'));
    const sources = workerData.files
        .filter(file => !file.includes('/node_modules/') && /\.(svelte|svx|js|ts)$/.test(file))
        .map(file => `@source ${quote(file)};`).join('\n');
    const vars = Object.entries(workerData.theme).map(([key, value]) => `--${key.replace(/^--/, '')}: ${value};`).join('\n');
    const input = `@import ${quote(cssPath)} source(none);\n${sources}\n${vars ? `@theme { ${vars} }` : ''}`;
    const result = await postcss([tailwind({ base: workerData.workspace, optimize: true })])
        .process(input, { from: path.join(workerData.cacheDir, 'tailwind-input.css') });
    parentPort.postMessage({ css: result.css });
})().catch(error => parentPort.postMessage({ error: error.message }));
//# sourceMappingURL=tailwind-worker.js.map