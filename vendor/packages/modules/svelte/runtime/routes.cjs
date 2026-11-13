'use strict';

const fs = require('fs');
const path = require('path');
const { compressedAssets, versionedAsset } = require('./assets.cjs');

// The host supplies its HTTP mount, authorization-aware resolver and renderer.
function mountPackageViews(container, pkg, { getEngine, getPackageMount, replacePublicViews, resolveEntryView, renderPage, staticAssets }) {
  if (container.config?.views?.enabled === false) return;
  const viewsDir = path.join(pkg.dir, 'views');
  if (!fs.existsSync(viewsDir)) return;
  replacePublicViews(container, pkg.folder, viewsDir);
  const engine = getEngine(container);
  const mounted = container.state('views');
  if (!mounted.get('registryBuilt')) {
    engine.buildWidgetRegistry(container.workspace);
    mounted.set('registryBuilt', true);
  }
  const mount = getPackageMount(container);
  if (!mounted.get('cacheMounted')) {
    mount.use('/svelte-cache', compressedAssets(engine.cacheDir), staticAssets(engine.cacheDir, {
      setHeaders(res, filePath) {
        if (filePath.endsWith('.mjs')) res.setHeader('Content-Type', 'application/javascript');
        if (versionedAsset(path.basename(filePath))) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          res.setHeader('Vary', 'Accept-Encoding');
        }
      },
    }));
    mounted.set('cacheMounted', true);
  }
  if (!mounted.get(`route:${pkg.folder}`)) {
    mount.get(`/view/${pkg.folder}`, (req, res) => {
      const entry = resolveEntryView(viewsDir, Boolean(req.user));
      if (!entry) return res.status(404).send(`[views] no entry page found in package "${pkg.folder}"`);
      return renderPage(container, pkg.folder, entry.page, { ...req.query }, res, Boolean(req.user));
    });
    mount.get(`/view/${pkg.folder}/:page`, (req, res) =>
      renderPage(container, pkg.folder, req.params.page, { ...req.query }, res, Boolean(req.user)));
    mounted.set(`route:${pkg.folder}`, true);
    container.log(`${pkg.name ?? pkg.folder} registered [GET] /view/${pkg.folder}[/:page] → views/*.svelte`);
  }
}

module.exports = { mountPackageViews };
