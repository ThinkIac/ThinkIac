const os = require('os');
const fs = require('fs');
const path = require('path');
const { normalizeManifestSlots } = require('./slots');
const { mobileApps } = require('./mobile_apps');
const { resolveIconPreset } = require('./icon_presets');
const { requiredViewPermission } = require('../../../../auth/discovery_permissions.cjs');
// sharp (redimensionamento de ícone) é OPCIONAL e carregado sob demanda.
//
// Era um require de topo, e isso mantinha o pacote inteiro fora do runtime do
// tenant: a imagem mínima não traz sharp (dep nativa pesada), então o require
// estourava no carregamento, o Shell não registrava GET /apps/list, e a
// tela de apps do tenant ficava permanentemente vazia — mesmo com os plugins
// instalados corretamente em packages/.
//
// Sem sharp o ícone não é redimensionado, e só: o arquivo original vai como
// data URI, que é o que já acontecia com SVG.
let sharpMod = null;
let sharpChecked = false;
function loadSharp() {
  if (!sharpChecked) {
    sharpChecked = true;
    try {
      sharpMod = require('sharp');
    } catch {
      console.warn('[shell] sharp is unavailable — raster icons are served without resizing.');
    }
  }
  return sharpMod;
}

// Manifests hoje só devem trazer cor CSS de verdade (hex/rgb/hsl) — não dá
// pra usar classe Tailwind (ex: "bg-emerald-500") como valor de `style`
// inline, o navegador simplesmente ignora silenciosamente. Isso já causou
// bug de ícone sem fundo (ficava branco no tema dark): o frontend só
// aplicava o fallback de cor quando NENHUMA cor vinha do backend, então uma
// classe Tailwind "presente" mas inútil bloqueava o fallback sem entregar
// nada no lugar.
function isValidCssColor(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  return /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)
    || /^(rgb|hsl)a?\(/i.test(v);
}

// Package metadata is useful in the Shell's app information sheet, but it is
// still untrusted manifest input. Keep only small, presentational values and
// never copy credentials or arbitrary nested objects into the app catalog.
function packageInfoValue(value, limit = 160) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : null;
}

function packageRepository(value) {
  const repository = typeof value === 'string' ? value : value?.url;
  return packageInfoValue(repository);
}

function packageAuthor(value) {
  if (typeof value === 'string') return packageInfoValue(value);
  return packageInfoValue(value?.name);
}

/** Optional per-package Desktop opening size. Manual resizing remains unrestricted. */
function normalizeManifestWindow(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const width = Math.round(Number(value.width));
  const height = Math.round(Number(value.height));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 320 || height < 200 || width > 10_000 || height > 10_000) return null;
  return { width, height };
}

// Configuração opt-in para atalhos fixados do Android. O objeto exposto pela
// API nunca aceita URL arbitrária: o atalho sempre abre o pacote dono pela
// rota canônica thinkiac://open/app/<package> no aplicativo nativo.
function normalizeHomeShortcut(value, packageName, fallbackLabel) {
  if (value !== true && (!value || typeof value !== 'object')) return null;
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(packageName || '')) return null;

  const label = typeof value === 'object' && typeof value.name === 'string'
    ? value.name.trim().slice(0, 40)
    : fallbackLabel;

  if (!label) return null;
  return { packageName, label };
}

// Ação contextual declarada por um pacote para o menu de cabeçalho de uma
// view. O Shell só transporta a intenção para o iframe alvo; o pacote alvo
// decide se conhece/aceita o evento. Assim um addon não recebe poder para
// executar código nem para navegar para uma URL arbitrária.
function normalizeHeaderAction(value, sourcePackage) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = String(value.id || '').trim();
  const label = String(value.label || '').trim();
  const targetPackage = String(value.target?.package || '').trim();
  const targetView = value.target?.view == null ? null : String(value.target.view).trim();
  const event = String(value.event || '').trim();
  if (!/^[a-z][a-z0-9-]*$/i.test(id)
    || !label
    || !/^[a-z0-9][a-z0-9-]*$/i.test(sourcePackage || '')
    || !/^[a-z0-9][a-z0-9-]*$/i.test(targetPackage)
    || (targetView && !/^[A-Za-z][A-Za-z0-9_-]*$/.test(targetView))
    || !/^[a-z][a-z0-9:._-]*$/i.test(event)) return null;
  return {
    id,
    label: label.slice(0, 80),
    ...(typeof value.description === 'string' && value.description.trim()
      ? { description: value.description.trim().slice(0, 180) } : {}),
    target: { package: targetPackage, ...(targetView ? { view: targetView } : {}) },
    event: event.slice(0, 120),
    order: Number.isFinite(Number(value.order)) ? Number(value.order) : 1000,
    sourcePackage,
  };
}

function normalizeHeaderActions(value, sourcePackage) {
  const actions = Array.isArray(value) ? value : [value];
  const seen = new Set();
  return actions.map((item) => normalizeHeaderAction(item, sourcePackage)).filter((item) => {
    if (!item || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

// Desktop widgets are full-canvas contributions, not launchable pages. They
// therefore get a synthetic catalog entry so packages with only
// views/widgets/*.svelte remain discoverable without becoming apps.
function normalizeDesktopWidgetContribution({ packageName, packageLabel, description = '', value } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(packageName || '')) return null;
  if (!value || typeof value !== 'object') return null;
  const id = String(value.id || '').trim();
  const component = String(value.component || '').trim();
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) return null;
  if (!/^[a-z0-9-]+__[a-z][a-z0-9_-]*$/i.test(component)) return null;
  const label = String(value.label || packageLabel || id).trim().slice(0, 80);
  if (!label) return null;
  return {
    id: `desktop-widget:${packageName}:${id}`,
    packageName,
    name: String(packageLabel || packageName),
    description: String(description || ''),
    native: true,
    default: false,
    desktopWidget: {
      id,
      label,
      component,
      order: Number.isFinite(Number(value.order)) ? Number(value.order) : 1000,
      description: String(value.description || '').slice(0, 240),
      defaultEnabled: value.defaultEnabled === true,
    },
  };
}

/** Resolves optional siblings without making them launchable app views. */
function resolveWidgetVariants(packagePath, component) {
  const [packageName, viewName, ...rest] = String(component || '').split('__');
  if (!packageName || !viewName || rest.length || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(viewName)) return null;
  const directory = path.join(packagePath, 'views', 'widgets');
  const variant = (suffix) => fs.existsSync(path.join(directory, `${viewName}.${suffix}.svelte`))
    ? `${packageName}__${viewName}.${suffix}`
    : null;
  const editable = variant('Editable');
  const config = variant('Config');
  return editable || config ? { ...(editable ? { editable } : {}), ...(config ? { config } : {}) } : null;
}

function normalizeWorkCanvasContribution(value) {
  if (!value || typeof value !== 'object') return null;
  const id = String(value.id || '').trim();
  const mode = value.mode === 'surface' ? 'surface' : 'floating';
  const width = Number(value.width);
  const height = Number(value.height);
  const component = String(value.component || '').trim();
  const view = String(value.view || '').trim();
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) return null;
  if (mode !== 'surface' && (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)) return null;
  if (!component && !view) return null;
  if (component && !/^[a-z0-9-]+__[a-z][a-z0-9_-]*$/i.test(component)) return null;
  const renderer = component ? 'component' : 'view';
  return {
    id,
    label: String(value.label || id).trim().slice(0, 80),
    group: String(value.group || 'Outro').trim().slice(0, 40),
    renderer,
    ...(renderer === 'component' ? { component } : {}),
    ...(mode === 'surface' ? { mode } : { width, height }),
    ...(value.fixed === 'left' || value.fixed === 'right' || value.fixed === 'rail' ? { fixed: value.fixed } : {}),
    order: Number.isFinite(Number(value.order)) ? Number(value.order) : 1000,
    description: String(value.description || '').slice(0, 240),
    interactive: value.interactive === true,
  };
}

function normalizeWorkCanvasPackageContribution({ packageName, packageLabel, description = '', value } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(packageName || '')) return null;
  const workCanvas = normalizeWorkCanvasContribution(value);
  if (!workCanvas || workCanvas.renderer !== 'component') return null;
  return {
    id: `work-canvas:${packageName}:${workCanvas.id}`,
    packageName,
    name: String(packageLabel || packageName),
    description: String(description || ''),
    native: true,
    default: false,
    workCanvas,
  };
}

// Work UIs are attachable surfaces in the Work Canvas. Like desktop widgets,
// they may be declared by a headless package, so the catalog needs a synthetic
// entry for the Desktop to discover them.
function normalizeWorkUiPackageContribution({ packageName, packageLabel, description = '', value } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(packageName || '')) return null;
  if (!value || typeof value !== 'object') return null;
  const id = String(value.id || '').trim();
  const component = String(value.component || '').trim();
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) return null;
  if (!/^[a-z0-9-]+__[a-z][a-z0-9_-]*$/i.test(component)) return null;
  return {
    id: `work-ui:${packageName}:${id}`,
    packageName,
    name: String(packageLabel || packageName),
    description: String(description || ''),
    native: true,
    default: false,
    workUi: {
      id,
      label: String(value.label || packageLabel || id).trim().slice(0, 80),
      component,
      width: Number(value.width) > 0 ? Number(value.width) : 420,
      height: Number(value.height) > 0 ? Number(value.height) : 620,
      ...(value.defaultSlot === 'left' || value.defaultSlot === 'right' || value.defaultSlot === 'bottom'
        ? { defaultSlot: value.defaultSlot } : {}),
      defaultEnabled: value.defaultEnabled === true,
      interactive: value.interactive === true,
      order: Number.isFinite(Number(value.order)) ? Number(value.order) : 1000,
      description: String(value.description || '').slice(0, 240),
    },
  };
}

// Single Workspace declares an app-owned direct canvas entry. It deliberately
// accepts only a package-local view name, never an arbitrary URL.
function normalizeSingleWorkspacePackageContribution({ packageName, packageLabel, description = '', value } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(packageName || '')) return null;
  // v4 keeps the same safe, package-local view contract as v2/v3.  It adds
  // independently rendered widgets, so rejecting it makes the declaration
  // disappear from /apps/list and the Desktop has nothing to open.
  if (!value || typeof value !== 'object' || ![1, 2, 3, 4, 5].includes(value.version)) return null;
  const view = String(value.view || '').trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(view)) return null;
  const components = value.version >= 2 ? (Array.isArray(value.components) ? value.components : null) : [];
  if (value.version >= 2 && !components?.length) return null;
  // Some canvases edit a durable domain item. The Desktop may create that item
  // through this narrowly scoped declaration before mounting its views; it is
  // not an arbitrary request proxy.
  let create = null;
  if (value.create !== undefined) {
    const path = String(value.create?.path || '');
    const method = String(value.create?.method || 'POST').toUpperCase();
    const response = String(value.create?.response || '');
    if (!path.startsWith(`/${packageName}/`) || method !== 'POST' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(response)) return null;
    create = { path, method, response };
  }
  const normalizedComponents = (components || []).map((component) => {
    const id = String(component?.id || '').trim();
    const componentView = String(component?.view || '').trim();
    if (!/^[a-z][a-z0-9-]*$/i.test(id) || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(componentView)) return null;
    const x = Number(component.position?.x);
    const y = Number(component.position?.y);
    const width = Number(component.size?.width);
    const height = Number(component.size?.height);
    return {
      id, view: componentView,
      ...(typeof component.role === 'string' ? { role: component.role.slice(0, 80) } : {}),
      ...(typeof component.label === 'string' ? { label: component.label.slice(0, 80) } : {}),
      position: { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 },
      size: {
        width: Number.isFinite(width) ? Math.max(320, Math.min(1600, width)) : 880,
        height: Number.isFinite(height) ? Math.max(260, Math.min(1200, height)) : 620,
      },
      ...(value.version >= 5 ? {
        mode: component.mode === 'surface' ? 'surface' : 'desktop',
        uiPosition: {
          x: Number.isFinite(Number(component.uiPosition?.x)) ? Math.max(0, Math.min(100, Number(component.uiPosition.x))) : 50,
          y: Number.isFinite(Number(component.uiPosition?.y)) ? Math.max(0, Math.min(100, Number(component.uiPosition.y))) : 50,
        },
      } : {}),
      ...(component.fixed === true ? { fixed: true } : {}),
    };
  });
  if (normalizedComponents.some((component) => !component)) return null;
  return {
    id: `single-workspace:${packageName}`,
    packageName,
    name: String(packageLabel || packageName),
    description: String(description || ''),
    native: true,
    default: false,
    singleWorkspace: {
      version: value.version,
      label: String(value.label || packageLabel || packageName).trim().slice(0, 80),
      description: String(value.description || '').slice(0, 240),
      url: `/view/${packageName}/${view}`,
      ...(create ? { create } : {}),
      ...(value.version >= 2 ? { components: normalizedComponents } : {}),
      ...(value.presentation === 'workspaceTemplate' ? { presentation: 'workspaceTemplate' } : {}),
      ...(value.presentation === 'nativeCanvas' ? { presentation: 'nativeCanvas' } : {}),
      ...(String(value.icon || '').startsWith(`/${packageName}/`) ? { icon: String(value.icon) } : {}),
    },
  };
}

// A canvas document has one domain surface and ordinary Desktop UI panels.
// It intentionally has no presentation mode: the Desktop owns composition.
function normalizeCanvasDocumentPackageContribution({ packageName, packageLabel, description = '', value } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(packageName || '') || !value || typeof value !== 'object' || ![1, 2].includes(value.version)) return null;
  const view = String(value.surface?.view || '').trim();
  const surfaceId = String(value.surface?.id || '').trim();
  if (!/^[a-z][a-z0-9-]*$/i.test(surfaceId) || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(view)) return null;
  const panels = Array.isArray(value.panels) ? value.panels.map((panel) => {
    const id = String(panel?.id || '').trim(); const panelView = String(panel?.view || '').trim();
    if (!/^[a-z][a-z0-9-]*$/i.test(id) || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(panelView)) return null;
    return { id, view: panelView, role: String(panel.role || id).slice(0, 80), label: String(panel.label || id).slice(0, 80), uiPosition: { x: Math.max(0, Math.min(100, Number(panel.uiPosition?.x) || 50)), y: Math.max(0, Math.min(100, Number(panel.uiPosition?.y) || 50)) }, size: { width: Math.max(160, Math.min(1600, Number(panel.size?.width) || 320)), height: Math.max(120, Math.min(1200, Number(panel.size?.height) || 240)) } };
  }) : [];
  if (panels.some((panel) => !panel)) return null;
  const create = value.create;
  if (create && (String(create.path || '').startsWith(`/${packageName}/`) === false || String(create.method || 'POST').toUpperCase() !== 'POST' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(String(create.response || '')))) return null;
  return { id: `canvas-document:${packageName}`, packageName, name: String(packageLabel || packageName), description: String(description || ''), native: true, default: false, canvasDocument: { version: value.version, label: String(value.label || packageLabel || packageName).slice(0, 80), description: String(value.description || '').slice(0, 240), surface: { id: surfaceId, view, mode: 'surface', label: String(value.surface.label || value.label || packageLabel || packageName).slice(0, 80) }, panels, ...(create ? { create: { path: String(create.path), method: 'POST', response: String(create.response) } } : {}), ...(String(value.icon || '').startsWith(`/${packageName}/`) ? { icon: String(value.icon) } : {}) } };
}

async function isValidView(url) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    const contentType = response.headers.get('content-type');

    return response.ok && contentType && contentType.includes('text/html');
  } catch (err) {
    return false;
  }
}

async function getImageIcon(pkgPath, customPath = null) {
  const extensions = ['.png', '.jpg', '.jpeg', '.webp'];

  // 1. Prioridade: Se houver um caminho customizado, tenta ele primeiro
  const pathsToTry = customPath
    ? [path.resolve(pkgPath, customPath)] // Resolve o caminho relativo ao pkgPath
    : extensions.map(ext => path.join(pkgPath, `icon${ext}`));

  for (const iconPath of pathsToTry) {
    if (fs.existsSync(iconPath)) {
      try {
        const resizer = loadSharp();
        const buffer = resizer
          ? await resizer(iconPath)
            .resize(120, 120, {
              fit: 'cover',
              position: 'center'
            })
            .toBuffer()
          : fs.readFileSync(iconPath);

        // Extrai a extens├úo do arquivo atual para o MimeType
        const currentExt = path.extname(iconPath).toLowerCase();
        const mimeType = currentExt === '.jpg' || currentExt === '.jpeg'
          ? 'image/jpeg'
          : `image/${currentExt.replace('.', '')}`;

        return `data:${mimeType};base64,${buffer.toString('base64')}`;
      } catch (err) {
        console.error(`Failed to process icon at ${iconPath}:`, err);
        // Se falhar no customPath, talvez voc├¬ queira continuar tentando os padr├Áes
        if (customPath && iconPath === path.resolve(pkgPath, customPath)) continue;
        return null;
      }
    }
  }

  return null;
}

// Sanitização mínima antes de injetar o SVG cru no frontend via {@html} —
// não é um sanitizer completo, cobre os vetores de XSS relevantes num
// ícone de app (script, handlers inline, href javascript:, foreignObject).
function sanitizeSvg(raw) {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(xlink:href|href)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1=""')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
}

// Best-effort: troca fill/stroke de cor fixa por currentColor, pra o ícone
// herdar `color` do CSS (manifest.color / fallback do tema). Cobre o caso
// comum de logo monocromático; SVG com gradiente/várias cores deve setar
// manifest.colored:false pra manter as cores originais.
function recolorSvgToCurrentColor(svg) {
  return svg
    .replace(/\bfill="(?!none)[^"]*"/gi, 'fill="currentColor"')
    .replace(/\bfill:\s*(?!none)[^;"']+/gi, 'fill:currentColor')
    .replace(/\bstroke="(?!none)[^"]*"/gi, 'stroke="currentColor"');
}

async function getSvgIcon(pkgPath, customPath, colored) {
  const iconPath = path.resolve(pkgPath, customPath);
  if (!fs.existsSync(iconPath)) return null;
  try {
    let raw = fs.readFileSync(iconPath, 'utf-8');
    if (!/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(raw)) return null;
    raw = sanitizeSvg(raw);
    if (colored !== false) raw = recolorSvgToCurrentColor(raw);
    return raw;
  } catch (err) {
    console.error(`Failed to process SVG at ${iconPath}:`, err);
    return null;
  }
}

// Resolve o ícone de um pacote pra {type:'svg', value: markup} (mantém
// vetorial + recolorível) ou {type:'raster', value: dataUri} (PNG/JPG/WEBP
// rasterizado). SVG só é tratado como tal quando reconhecido pela extensão
// — do contrário cai no rasterizador de sempre.
async function resolveIcon(pkgPath, customPath = null, colored = true) {
  if (customPath) {
    if (String(customPath).toLowerCase().endsWith('.svg')) {
      const svg = await getSvgIcon(pkgPath, customPath, colored);
      return svg ? { type: 'svg', value: svg } : null;
    }
    const raster = await getImageIcon(pkgPath, customPath);
    return raster ? { type: 'raster', value: raster } : null;
  }
  const svg = await getSvgIcon(pkgPath, 'icon.svg', colored);
  if (svg) return { type: 'svg', value: svg };
  const raster = await getImageIcon(pkgPath);
  return raster ? { type: 'raster', value: raster } : null;
}

/**
 * Normaliza como o manifest declara ícone por tema. Duas formas, equivalentes:
 *
 *   "icon": "assets/icon.svg", "iconDark": "assets/icon-dark.svg"
 *   "icon": { "light": "assets/icon.svg", "dark": "assets/icon-dark.svg" }
 *
 * A forma objeto existe porque é ela que "cita explicitamente o ícone para
 * cada tema" — o par icon/iconDark continua valendo e é o que os pacotes já
 * usam, então nada precisa migrar. Declarar as duas formas não é erro: a
 * chave dedicada (`iconDark`) ganha, por ser a mais específica.
 */
function normalizeIconManifest(manifest = {}) {
  const raw = manifest.icon;
  const isThemeMap = raw && typeof raw === 'object' && !Array.isArray(raw);

  const light = isThemeMap ? (raw.light ?? raw.default ?? null) : (raw ?? null);
  const dark = manifest.iconDark ?? (isThemeMap ? (raw.dark ?? null) : null);

  return { light, dark };
}

function getPackageViews() {
  /**
   * @register_hook aura:apps:views
   */
  const packagesRoot = path.resolve(__dirname, '../../../../');
  const results = [];

  const directories = fs.readdirSync(packagesRoot).filter(dir => {
    return fs.statSync(path.join(packagesRoot, dir)).isDirectory();
  });

  directories.forEach(pkgDir => {
    const pkgPath = path.join(packagesRoot, pkgDir);
    const pkgJsonPath = path.join(pkgPath, 'package.json');
    const viewsPath = path.join(pkgPath, 'views');

    if (fs.existsSync(pkgJsonPath) && fs.existsSync(viewsPath)) {
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
      const manifest = pkgJson.manifest || {};
      if (manifest.hidden === true || (process.env.TENANT_ID && manifest.tenantHidden === true)) return;
      const pkgName = pkgJson.name || pkgDir;

      // A existência de um componente em `views/` não é uma declaração de
      // aplicativo. Widgets, editores auxiliares e previews também vivem ali
      // e antes todos acabavam publicados no launcher.
      //
      // A compatibilidade é deliberadamente estreita: Index/Home continuam
      // sendo a página principal convencional. Qualquer outra página precisa
      // ser declarada em `manifest.page[].source`. `manifest.launch: false`
      // permite que um pacote com Index/Home seja somente uma contribuição de
      // UI, sem aparecer como aplicativo.
      // `.public.svelte` é marcador de filesystem do Lógos, não parte da URL.
      // Consolidar as variantes mantém a mesma rota limpa do resolvedor.
      const discoveredViews = new Map();
      for (const file of fs.readdirSync(viewsPath)) {
        if (!file.endsWith('.svelte')) continue;
        const publicMatch = file.match(/^(.*)\.public\.svelte$/i);
        const viewName = publicMatch ? publicMatch[1] : file.replace(/\.svelte$/i, '');
        if (!viewName) continue;
        const entry = discoveredViews.get(viewName) || { public: false };
        if (publicMatch) entry.public = true;
        discoveredViews.set(viewName, entry);
      }
      const declaredPageSources = new Set(
        (Array.isArray(manifest.page) ? manifest.page : [])
          .map((page) => String(page?.source || '')
            .replace(/^\.?\//, '')
            .replace(/^views\//i, '')
            .replace(/\.svelte$/i, ''))
          .filter((viewName) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(viewName)),
      );
      const launchDisabled = manifest.launch === false;
      const launchableViewNames = [...discoveredViews.keys()].filter((viewName) =>
        !launchDisabled
        && (['index', 'home'].includes(viewName.toLowerCase()) || declaredPageSources.has(viewName)),
      );
      // Contribuições continuam precisando de uma URL renderizável, mas não
      // ganham o status de app. Isso separa, por exemplo, Widget.svelte do
      // app completo sem quebrar widgets de chat, menu ou InputBar.
      const contributionViews = [
        manifest.widget,
        manifest.menu,
        manifest.background,
        manifest.inputbar,
        manifest.workCanvas,
      ].flatMap((value) => Array.isArray(value) ? value : [value])
        .map((value) => value && typeof value === 'object' && value.view && value.view !== true
          ? String(value.view).replace(/\.svelte$/i, '')
          : null)
        .filter((viewName) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(viewName));
      // A launcher widget can use a compact view distinct from the inline
      // chat widget of the same package. It remains a contribution, never a
      // regular app shortcut.
      contributionViews.push(
        ...(Array.isArray(manifest.widget) ? manifest.widget : [manifest.widget])
          .map((value) => value?.launcher?.view && String(value.launcher.view).replace(/\.svelte$/i, ''))
          .filter((viewName) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(viewName)),
      );
      // Menus podem também ocupar o Launcher, mas somente quando isso for
      // declarado. Um menu comum jamais vira widget por acidente.
      contributionViews.push(
        ...(Array.isArray(manifest.menu) ? manifest.menu : [manifest.menu])
          .map((value) => value?.launcher?.view && String(value.launcher.view).replace(/\.svelte$/i, ''))
          .filter((viewName) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(viewName)),
      );
      const contributionUsesDefaultView = [
        manifest.widget,
        manifest.menu,
        manifest.background,
        manifest.inputbar,
        manifest.workCanvas,
      ].flatMap((value) => Array.isArray(value) ? value : [value])
        .some((value) => value && typeof value === 'object' && !value.view);
      if (contributionUsesDefaultView || manifest.composerSlot || Array.isArray(manifest.messageActions)) {
        contributionViews.push(...[...discoveredViews.keys()].filter((name) => ['index', 'home'].includes(name.toLowerCase())));
      }
      const catalogViewNames = [...new Set([...launchableViewNames, ...contributionViews])]
        .filter((viewName) => discoveredViews.has(viewName));
      let views = launchableViewNames.map(viewName => `/view/${pkgName}/${viewName}`);
      const catalogViews = catalogViewNames.map(viewName => `/view/${pkgName}/${viewName}`);
      const publicViews = new Set(
        [...discoveredViews.entries()]
          .filter(([, entry]) => entry.public)
          .map(([viewName]) => `/view/${pkgName}/${viewName}`),
      );

      views.sort((a, b) => {
        const priority = (p) => {
          if (p.toLowerCase().endsWith('/index')) return 0;
          if (p.toLowerCase().endsWith('/home')) return 1;
          return 2;
        };
        return priority(a) - priority(b);
      });

      // O Agent fornece o runtime conversacional usado pelo Shell, mas não é
      // uma segunda interface lançável. Publicar as duas views cria um app
      // duplicado que abre o Shell dentro do próprio Shell.
      if (pkgJson.name !== 'agent') {
        results.push({ fullPath: pkgPath, package: pkgJson, views, catalogViews, publicViews });
      } else if (manifest.desktopWidget) {
        // Agent é o shell do Runtime, não um app que pode abrir dentro de si
        // mesmo. Ainda assim, ele pode contribuir um canvas de Desktop. Não
        // publique as suas views: assim o catálogo recebe apenas o widget.
        results.push({ fullPath: pkgPath, package: pkgJson, views: [], publicViews: new Set() });
      }
    }
  });

  return results;
}

// Algumas capacidades do Shell são auxiliares e não devem ser publicadas no
// catálogo de apps (por exemplo, uma biblioteca contextual de artefatos). A
// presença do pacote ainda precisa ser verificável antes de a UI oferecer uma
// ação que dependeria dele.
function getPackageAvailability(names = []) {
  const requested = [...new Set((Array.isArray(names) ? names : [])
    .map((name) => String(name || '').trim())
    .filter((name) => /^[a-z0-9][a-z0-9-]*$/i.test(name)))];
  const available = Object.fromEntries(requested.map((name) => [name, false]));
  if (!requested.length) return available;

  const packagesRoot = path.resolve(__dirname, '../../../../');
  for (const directory of fs.readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const packageFile = path.join(packagesRoot, directory.name, 'package.json');
    if (!fs.existsSync(packageFile)) continue;
    try {
      const packageName = JSON.parse(fs.readFileSync(packageFile, 'utf8')).name;
      if (Object.hasOwn(available, packageName)) available[packageName] = true;
    } catch {
      // Um manifesto inválido não representa um pacote disponível.
    }
  }
  return available;
}

async function getActiveApps(_currentUrl = '', mobileAppId = '', options = {}) {
  /**
  * @register_hook aura:apps:list
  */
  const packages = getPackageViews();
  const nativeAppsPromises = [];

  packages.forEach(pkg => {
    const manifest = pkg.package?.manifest || {};
    const coloredSvg = manifest.colored !== false; // nativo é true
    const { light: iconLight, dark: iconDark } = normalizeIconManifest(manifest);
    // Presets são resolvidos no servidor para o mesmo SVG inline que os
    // assets locais. Assim os renderers de Launcher, menu e abas não precisam
    // conhecer uma biblioteca específica de ícones.
    const presetIcon = resolveIconPreset(manifest.iconPreset);
    const iconPromise = presetIcon
      ? Promise.resolve({ type: 'svg', value: presetIcon })
      : resolveIcon(pkg.fullPath, iconLight, coloredSvg);
    const iconDarkPromise = iconDark
      ? resolveIcon(pkg.fullPath, iconDark, coloredSvg)
      : Promise.resolve(null);

    const desktopWidget = normalizeDesktopWidgetContribution({
      packageName: pkg.package.name,
      packageLabel: manifest.name || pkg.package.name,
      description: pkg.package.description,
      value: manifest.desktopWidget,
    });
    if (desktopWidget) desktopWidget.desktopWidget.variants = resolveWidgetVariants(pkg.fullPath, desktopWidget.desktopWidget.component);
    if (desktopWidget) nativeAppsPromises.push(Promise.resolve(desktopWidget));
    const contributionArgs = {
      packageName: pkg.package.name,
      packageLabel: manifest.name || pkg.package.name,
      description: pkg.package.description,
    };
    for (const value of (Array.isArray(manifest.workCanvas) ? manifest.workCanvas : [manifest.workCanvas])) {
      const workCanvasComponent = normalizeWorkCanvasPackageContribution({ ...contributionArgs, value });
      if (workCanvasComponent) workCanvasComponent.workCanvas.variants = resolveWidgetVariants(pkg.fullPath, workCanvasComponent.workCanvas.component);
      if (workCanvasComponent) nativeAppsPromises.push(Promise.resolve(workCanvasComponent));
    }
    for (const value of (Array.isArray(manifest.workUi) ? manifest.workUi : [manifest.workUi])) {
      const workUiComponent = normalizeWorkUiPackageContribution({ ...contributionArgs, value });
      if (workUiComponent) nativeAppsPromises.push(Promise.resolve(workUiComponent));
    }
    const singleWorkspace = normalizeSingleWorkspacePackageContribution({ ...contributionArgs, value: manifest.singleWorkspace });
    if (singleWorkspace) nativeAppsPromises.push(Promise.resolve(singleWorkspace));
    const canvasDocument = normalizeCanvasDocumentPackageContribution({ ...contributionArgs, value: manifest.canvasDocument });
    if (canvasDocument) nativeAppsPromises.push(Promise.resolve(canvasDocument));

    // Nome declarado para a view no manifest (`manifest.page[].source`). O
    // manifest sempre prometeu isso e ninguém lia: o rótulo saía do NOME DO
    // ARQUIVO, então "Publish App" virava "Store - Publish". Quem não declara
    // `page` continua no derivado de sempre.
    const declaredPages = new Map(
      (pkg.package?.manifest?.page || [])
        .filter(p => p?.source && p?.name)
        .map(p => [p.source.replace(/^\.?\//, '').replace(/\.svelte$/i, ''), p.name])
    );

    (pkg.catalogViews || pkg.views).forEach(viewPath => {
      const viewName = viewPath.split('/').pop();
      const pkgName = pkg.package?.manifest?.name || pkg.package.name || 'App';
      const formattedPkgName = pkgName.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      const formattedViewName = viewName.charAt(0).toUpperCase() + viewName.slice(1);

      const declaredName = declaredPages.get(`views/${viewName}`);
      const finalName = declaredName
        ? declaredName
        : (['index', 'home'].includes(viewName.toLowerCase())
          ? formattedPkgName
          : `${formattedPkgName} - ${formattedViewName}`);

      nativeAppsPromises.push((async () => {
        const [icon, iconDark] = await Promise.all([iconPromise, iconDarkPromise]);
        const appObj = {
          // Views are same-origin applications.  Publishing a relative route
          // makes the launcher follow the origin actually used by the
          // browser (beta, localhost, a preview port, etc.) instead of the
          // deployment-time APP_URL inherited by the process.
          id: `external:${viewPath}`,
          // Identificador estável do pacote. `name` é apenas o rótulo da
          // view e pode ser, por exemplo, "Ntfy - Widget"; registries que
          // precisam montar uma rota não podem usá-lo como segmento de URL.
          packageName: pkg.package.name || pkgName,
          // Dados canônicos do package.json. O `id` externo continua sendo a
          // chave de compatibilidade da aba, mas não é a identidade que a UI
          // deve apresentar como informação do aplicativo.
          version: pkg.package.version || null,
          view: viewName,
          entrypoint: typeof pkg.package.main === 'string' ? pkg.package.main : null,
          packageType: packageInfoValue(pkg.package.type, 40),
          license: packageInfoValue(pkg.package.license, 80),
          homepage: packageInfoValue(pkg.package.homepage),
          repository: packageRepository(pkg.package.repository),
          author: packageAuthor(pkg.package.author),
          nodeEngine: packageInfoValue(pkg.package.engines?.node, 80),
          keywords: Array.isArray(pkg.package.keywords)
            ? pkg.package.keywords.filter(keyword => typeof keyword === 'string' && keyword.trim()).slice(0, 8).map(keyword => keyword.trim().slice(0, 40))
            : [],
          scriptCount: pkg.package.scripts && typeof pkg.package.scripts === 'object' ? Object.keys(pkg.package.scripts).length : 0,
          dependencyCount: pkg.package.dependencies && typeof pkg.package.dependencies === 'object' ? Object.keys(pkg.package.dependencies).length : 0,
          viewCount: (pkg.catalogViews || pkg.views).length,
          name: finalName,
          description: pkg.package.description || `Native View: ${formattedPkgName}`,
          native: true,
          url: viewPath,
          default: pkg.views.includes(viewPath) && ['index', 'home'].includes(viewName.toLowerCase()),
          // `manifest.mobile: false` mantém uma view no catálogo geral, mas
          // permite que launchers móveis não a ofereçam como destino.
          mobileSupported: manifest.mobile !== false,
          // Apenas metadado visual: accessGate e Lógos continuam sendo a
          // fonte de verdade para autorização e seleção da variante da view.
          public: pkg.publicViews?.has(viewPath) === true,
          requiredPermission: requiredViewPermission(pkg.package, viewName),
        };
        // `manifest.headerActions` é uma contribuição de pacote, por isso é
        // publicada no catálogo e resolvida no Shell contra a view que está
        // aberta. Repetir o metadado nas views do pacote é intencional: o
        // consumidor deduplica por `sourcePackage:id`, e um pacote sem Index
        // continua podendo contribuir a partir de uma view auxiliar.
        const headerActions = normalizeHeaderActions(manifest.headerActions, appObj.packageName);
        if (headerActions.length) appObj.headerActions = headerActions;
        // sem ícone/cor válidos, deixa em branco — o frontend já sabe cair
        // pro fallback visual do tema (var(--rail-flat)/var(--rail-txt)),
        // não vale inventar cor aqui (era a causa do bug do fundo branco
        // no tema dark: um valor "presente" mas inútil bloqueava o
        // fallback sem entregar nada de verdade no lugar).
        if (icon?.type === 'raster') appObj.icon = icon.value;
        else if (icon?.type === 'svg') appObj.iconSvg = icon.value;
        if (iconDark?.type === 'raster') appObj.iconDark = iconDark.value;
        else if (iconDark?.type === 'svg') appObj.iconDarkSvg = iconDark.value;

        if (isValidCssColor(manifest.color)) appObj.color = manifest.color;
        if (isValidCssColor(manifest.bgColor)) appObj.bgColor = manifest.bgColor;
        // Ícones vetoriais e presets precisam de respiro para não encostar no
        // limite do bloco. Fotos e outros assets raster já trazem sua própria
        // composição, portanto ocupam o bloco inteiro por padrão.
        const hasRasterIcon = icon?.type === 'raster' || iconDark?.type === 'raster';
        appObj.padding = typeof manifest.padding === 'number'
          ? manifest.padding
          : (hasRasterIcon ? 0 : 7);
        if (manifest.noBorder) appObj.noBorder = true;
        const manifestWindow = normalizeManifestWindow(manifest.window);
        if (manifestWindow) appObj.window = manifestWindow;

        // Só a view principal pode criar o atalho do pacote. Assim um
        // pacote com views auxiliares não gera vários atalhos idênticos.
        if (appObj.default) {
          const homeShortcut = normalizeHomeShortcut(
            manifest.homeShortcut,
            appObj.packageName,
            pkgName,
          );
          if (homeShortcut) appObj.homeShortcut = homeShortcut;
        }

        if (manifest.url) appObj.id = `external:${manifest.url}`;
        if (manifest.widget) {
          // Por padrão widgets usam a view principal. Pacotes que possuem uma
          // view compacta própria (como o painel Codex no Sidebar) podem
          // selecioná-la via manifest.widget.view, sem registrar o mesmo lang
          // duas vezes com URLs diferentes.
          const widgetView = manifest.widget.view ? String(manifest.widget.view).toLowerCase() : null;
          const launcherView = manifest.widget.launcher?.view
            ? String(manifest.widget.launcher.view).toLowerCase()
            : null;
          const isDefaultView = ['index', 'home'].includes(viewName.toLowerCase());
          const isInlineWidgetView = !widgetView ? isDefaultView : viewName.toLowerCase() === widgetView;
          const isLauncherWidgetView = launcherView && viewName.toLowerCase() === launcherView;
          if (isInlineWidgetView || isLauncherWidgetView) {
            appObj.widget = isLauncherWidgetView
              ? { ...manifest.widget, view: manifest.widget.launcher.view }
              : manifest.widget;
          }
        }
        if (manifest.background) {
          const backgroundCfg = manifest.background === true ? {} : manifest.background;
          const wantsView = backgroundCfg.view ? String(backgroundCfg.view).toLowerCase() : null;
          const isDefaultView = ['index', 'home'].includes(viewName.toLowerCase());
          if (!wantsView ? isDefaultView : viewName.toLowerCase() === wantsView) {
            appObj.background = backgroundCfg;
          }
        }
        if (manifest.menu) {
          // manifest.menu.view (nome do arquivo em views/, opcional) escolhe
          // QUAL view carrega o menu — sem isso, cai na view default
          // (index/home), igual antes. Existe pra permitir uma view própria
          // e compacta pro widget do Sidebar, separada do app "cheio" que
          // o pacote pode ter em views/Index.svelte.
          const menuCfg = manifest.menu;
          const wantsView = menuCfg.view ? String(menuCfg.view).toLowerCase() : null;
          const isDefaultView = ['index', 'home'].includes(viewName.toLowerCase());
          const matchesView = wantsView ? viewName.toLowerCase() === wantsView : isDefaultView;
          if (matchesView) appObj.menu = menuCfg;

          // A declaração menu.launcher reaproveita a view compacta do menu no
          // Launcher nativo. Publicamos-a no mesmo formato de widget para
          // manter o consumidor mobile independente do tipo de contribuição.
          const launcherCfg = menuCfg.launcher;
          const launcherView = launcherCfg?.view
            ? String(launcherCfg.view).toLowerCase()
            : wantsView;
          const matchesLauncherView = launcherCfg === true
            ? matchesView
            : launcherCfg && typeof launcherCfg === 'object'
              && launcherView === viewName.toLowerCase();
          if (matchesLauncherView) {
            appObj.widget = {
              launcher: launcherCfg === true ? {} : launcherCfg,
              view: launcherCfg?.view || menuCfg.view,
            };
          }
        }
        if (manifest.workCanvas) {
          const workCfg = manifest.workCanvas;
          const wantsView = workCfg.view ? String(workCfg.view).toLowerCase() : null;
          const isDefaultView = ['index', 'home'].includes(viewName.toLowerCase());
          const matchesView = wantsView ? viewName.toLowerCase() === wantsView : isDefaultView;
          const normalized = normalizeWorkCanvasContribution(workCfg);
          if (matchesView && normalized?.renderer === 'view') appObj.workCanvas = { ...normalized, url: appObj.url };
        }
        if (manifest.inputbar) {
          // Entrada contribuída na InputBar (ver views/lib/inputbar_bootstrap.js).
          // Mesma regra de `menu`: manifest.inputbar.view escolhe qual view do
          // pacote abre no popover; sem isso, a view default.
          const barCfg = manifest.inputbar;
          const wantsView = barCfg.view && barCfg.view !== true ? String(barCfg.view).toLowerCase() : null;
          const isDefaultView = ['index', 'home'].includes(viewName.toLowerCase());
          const matchesView = wantsView ? viewName.toLowerCase() === wantsView : isDefaultView;
          if (matchesView) appObj.inputbar = barCfg;
        }
        if (manifest.composerSlot) {
          const slotCfg = manifest.composerSlot;
          const isDefaultView = ['index', 'home'].includes(viewName.toLowerCase());
          if (isDefaultView) appObj.composerSlot = slotCfg;
        }
        if (Array.isArray(manifest.messageActions)) {
          // Ações de mensagem são contribuições sem view própria: publicamos
          // apenas na view principal para não duplicar uma ação por arquivo
          // Svelte existente no pacote.
          const isDefaultView = ['index', 'home'].includes(viewName.toLowerCase());
          if (isDefaultView) appObj.messageActions = manifest.messageActions;
        }
        const slotContributions = normalizeManifestSlots(manifest.slots, appObj.packageName);
        if (slotContributions.length > 0) {
          appObj.slots = slotContributions.filter((entry) => {
            if (entry.view === false) return appObj.default;
            return viewName.toLowerCase() === entry.view.toLowerCase();
          }).map((entry) => ({ ...entry, url: appObj.url }));
          if (appObj.slots.length === 0) delete appObj.slots;
        }
        return appObj;
      })());
    });
  });

  const nativeApps = await Promise.all(nativeAppsPromises);

  const canDiscover = typeof options.canDiscover === 'function' ? options.canDiscover : null;
  const allApps = [...nativeApps, ...mobileApps.catalog(mobileAppId)]
    .filter((app) => isDiscoverableApp(app, canDiscover));
  allApps.sort((a, b) => a.name.localeCompare(b.name));

  return allApps;
}

function isDiscoverableApp(app, canDiscover = null) {
  // A view pública não pode ser escondida por uma permission de descoberta.
  // Para qualquer view protegida declarada, ausência de identidade ou de
  // grant significa ausência do catálogo, sem revelar seu nome ou rota.
  return !app?.requiredPermission || app.public || Boolean(canDiscover?.(app));
}

module.exports = {
  getActiveApps,
  getPackageAvailability,
  isDiscoverableApp,
  getPackageViews,
  normalizeDesktopWidgetContribution,
  resolveWidgetVariants,
  normalizeManifestWindow,
  normalizeHomeShortcut,
  normalizeHeaderAction,
  normalizeHeaderActions,
  normalizeWorkCanvasContribution,
  normalizeWorkCanvasPackageContribution,
  normalizeWorkUiPackageContribution,
  normalizeSingleWorkspacePackageContribution,
  resolveIconPreset,
};
