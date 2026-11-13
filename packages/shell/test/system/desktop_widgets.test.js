import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  getPackageViews,
  isDiscoverableApp,
  normalizeDesktopWidgetContribution,
  normalizeManifestWindow,
  normalizeHeaderAction,
  normalizeHeaderActions,
  normalizeWorkCanvasContribution,
  normalizeWorkCanvasPackageContribution,
  normalizeWorkUiPackageContribution,
  normalizeSingleWorkspacePackageContribution,
  resolveWidgetVariants,
} = require('../../runtime/system/apps/index.js');

test('filters a declared protected view from discovery without its permission', () => {
  const protectedView = { packageName: 'providers', view: 'Index', requiredPermission: 'providers.config.read', public: false };
  assert.equal(isDiscoverableApp(protectedView), false);
  assert.equal(isDiscoverableApp(protectedView, (app) => app.requiredPermission === 'providers.config.read'), true);
  assert.equal(isDiscoverableApp({ ...protectedView, public: true }), true);
  assert.equal(isDiscoverableApp({ packageName: 'legacy', view: 'Index' }), true);
});

test('publishes a desktop widget without requiring a top-level page', () => {
  assert.deepEqual(normalizeDesktopWidgetContribution({
    packageName: 'desktop-notes',
    packageLabel: 'Desktop Notes',
    description: 'Headless notes',
    value: { id: 'notes', label: 'Notes', component: 'desktop-notes__Notes', order: 10 },
  }), {
    id: 'desktop-widget:desktop-notes:notes',
    packageName: 'desktop-notes',
    name: 'Desktop Notes',
    description: 'Headless notes',
    native: true,
    default: false,
    desktopWidget: {
      id: 'notes', label: 'Notes', component: 'desktop-notes__Notes', order: 10,
      description: '', defaultEnabled: false,
    },
  });
});

test('normalizes the optional Desktop opening-size manifest contract', () => {
  assert.deepEqual(normalizeManifestWindow({ width: 920, height: 640 }), { width: 920, height: 640 });
  assert.equal(normalizeManifestWindow({ width: 12, height: 640 }), null);
  assert.equal(normalizeManifestWindow({ width: 920 }), null);
});

test('normalizes a bounded header action contribution from a package manifest', () => {
  assert.deepEqual(normalizeHeaderAction({
    id: 'edit-with-ai',
    label: 'Editar com IA',
    description: 'Abre o assistente para este projeto',
    target: { package: 'projects', view: 'Editor' },
    event: 'ai:edit-project',
    order: 20,
  }, 'ai-addon'), {
    id: 'edit-with-ai',
    label: 'Editar com IA',
    description: 'Abre o assistente para este projeto',
    target: { package: 'projects', view: 'Editor' },
    event: 'ai:edit-project',
    order: 20,
    sourcePackage: 'ai-addon',
  });
  assert.equal(normalizeHeaderAction({
    id: 'unsafe', label: 'Unsafe', target: { package: 'projects' }, event: 'https://example.test/run',
  }, 'ai-addon'), null);
});

test('drops duplicate and invalid header actions from one package', () => {
  const valid = { id: 'edit', label: 'Editar', target: { package: 'projects' }, event: 'ai:edit' };
  assert.deepEqual(normalizeHeaderActions([valid, valid, { id: 'bad id', label: 'No', target: {}, event: '' }], 'ai-addon'), [{
    ...valid,
    order: 1000,
    sourcePackage: 'ai-addon',
  }]);
});

test('rejects unsafe or incomplete desktop widget declarations', () => {
  assert.equal(normalizeDesktopWidgetContribution({
    packageName: 'bad', packageLabel: 'Bad', value: { id: '../x', component: 'X' },
  }), null);
  assert.equal(normalizeDesktopWidgetContribution({
    packageName: 'bad', packageLabel: 'Bad', value: { id: 'ok' },
  }), null);
});

test('discovers only declared editable and config siblings for a widget', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thinkiac-widget-'));
  const widgets = path.join(root, 'views', 'widgets');
  fs.mkdirSync(widgets, { recursive: true });
  fs.writeFileSync(path.join(widgets, 'Panel.Editable.svelte'), '<p>edit</p>');
  fs.writeFileSync(path.join(widgets, 'Panel.Config.svelte'), '<p>config</p>');
  try {
    assert.deepEqual(resolveWidgetVariants(root, 'sample__Panel'), {
      editable: 'sample__Panel.Editable', config: 'sample__Panel.Config',
    });
    assert.equal(resolveWidgetVariants(root, 'sample__Missing'), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the headless package is discovered with no launchable views', () => {
  const pkg = getPackageViews().find((entry) => entry.package.name === 'desktop-notes');
  assert.ok(pkg);
  assert.deepEqual(pkg.views, []);
});

test('does not turn auxiliary top-level views into launchable apps', () => {
  const tasks = getPackageViews().find((entry) => entry.package.name === 'tasks');
  assert.ok(tasks);
  assert.deepEqual(tasks.views, ['/view/tasks/Index']);

  const analytics = getPackageViews().find((entry) => entry.package.name === 'ui-analytics');
  assert.ok(analytics);
  assert.deepEqual(analytics.views, ['/view/ui-analytics/Home', '/view/ui-analytics/Usage']);
});

test('keeps an explicitly UI-only Index available for its contribution, not the launcher', () => {
  const governance = getPackageViews().find((entry) => entry.package.name === 'governance');
  assert.ok(governance);
  assert.deepEqual(governance.views, []);
  assert.deepEqual(governance.catalogViews, ['/view/governance/Approval']);
});

test('publishes the essential tenant management entries in the left menu', () => {
  const apps = getPackageViews();
  const menu = (name) => apps.find((entry) => entry.package.name === name)?.package.manifest?.menu;

  assert.deepEqual(menu('pkgmgr'), { id: 'packages', label: 'Pacotes', target: 'left', view: 'Index', order: 70, hidden: false });
  assert.deepEqual(menu('specialists'), { id: 'specialists', label: 'Especialistas', target: 'left', view: 'Index', hidden: false });
  assert.deepEqual(menu('providers'), { id: 'providers', label: 'Providers', target: 'left', view: 'Index', order: 85, hidden: false });
  assert.deepEqual(menu('thinkiac-provider'), { id: 'thinkiac-provider', label: 'ThinkIac Provider', target: 'left', view: 'Index', order: 95, hidden: false });
});

test('Agent never appears as a launchable app', () => {
  const pkg = getPackageViews().find((entry) => entry.package.name === 'agent');
  // Agent só entra no catálogo quando declara uma contribuição de Desktop.
  // Sem essa contribuição, sua ausência também preserva o contrato: ele não
  // pode se abrir recursivamente como app comum.
  assert.ok(!pkg || pkg.views.length === 0);
});

test('normalizes public-only views to their clean launch URL', () => {
  const pkg = getPackageViews().find((entry) => entry.package.name === 'desta-casa');
  assert.ok(pkg);
  assert.ok(pkg.views.includes('/view/desta-casa/Index'));
  assert.ok(pkg.publicViews.has('/view/desta-casa/Index'));
  assert.equal(pkg.views.some((view) => view.includes('.public')), false);
});

test('normalizes an extensible Work canvas contribution', () => {
  assert.deepEqual(normalizeWorkCanvasContribution({
    id: 'note', label: 'Nota', group: 'Nota', component: 'notes__Note', width: 320, height: 240,
  }), {
    id: 'note', label: 'Nota', group: 'Nota', renderer: 'component', component: 'notes__Note',
    width: 320, height: 240, order: 1000, description: '', interactive: false,
  });
  assert.equal(normalizeWorkCanvasContribution({ id: '../unsafe', component: 'x__Y', width: 320, height: 240 }), null);
  assert.equal(normalizeWorkCanvasContribution({ id: 'missing-renderer', width: 320, height: 240 }), null);
});

test('normalizes a dimensionless Work canvas surface', () => {
  assert.deepEqual(normalizeWorkCanvasContribution({
    id: 'annotations', label: 'Canvas', component: 'desktop-canvas__Annotations', mode: 'surface',
  }), {
    id: 'annotations', label: 'Canvas', group: 'Outro', renderer: 'component', component: 'desktop-canvas__Annotations',
    mode: 'surface', order: 1000, description: '', interactive: false,
  });
});

test('publishes a headless component contribution for Work canvas discovery', () => {
  assert.deepEqual(normalizeWorkCanvasPackageContribution({
    packageName: 'notes', packageLabel: 'Notes', description: 'Loose notes',
    value: { id: 'note', group: 'Nota', component: 'notes__Note', width: 320, height: 240 },
  }), {
    id: 'work-canvas:notes:note', packageName: 'notes', name: 'Notes', description: 'Loose notes',
    native: true, default: false,
    workCanvas: {
      id: 'note', label: 'note', group: 'Nota', renderer: 'component', component: 'notes__Note',
      width: 320, height: 240, order: 1000, description: '', interactive: false,
    },
  });
});

test('publishes an attachable Work UI from a headless package', () => {
  assert.deepEqual(normalizeWorkUiPackageContribution({
    packageName: 'teams', packageLabel: 'Teams', description: 'Tenant chat',
    value: { id: 'chat', label: 'Teams', component: 'teams__Teams', width: 420, height: 620, defaultSlot: 'left', defaultEnabled: true, interactive: true },
  }), {
    id: 'work-ui:teams:chat', packageName: 'teams', name: 'Teams', description: 'Tenant chat', native: true, default: false,
    workUi: {
      id: 'chat', label: 'Teams', component: 'teams__Teams', width: 420, height: 620,
      defaultSlot: 'left', defaultEnabled: true, interactive: true, order: 1000, description: '',
    },
  });
});

test('keeps rail contributions fixed in the Work Canvas contract', () => {
  assert.equal(normalizeWorkCanvasContribution({
    id: 'workspace-viewer', component: 'teams__Rail', width: 1, height: 1, fixed: 'rail',
  }).fixed, 'rail');
});

test('publishes a versioned Single Workspace entry with a package-local view only', () => {
  assert.deepEqual(normalizeSingleWorkspacePackageContribution({
    packageName: 'flows', packageLabel: 'Flows', description: 'Automation',
    value: { version: 1, view: 'Editor', label: 'Flow canvas' },
  }), {
    id: 'single-workspace:flows', packageName: 'flows', name: 'Flows', description: 'Automation', native: true, default: false,
    singleWorkspace: { version: 1, label: 'Flow canvas', description: '', url: '/view/flows/Editor' },
  });
  assert.equal(normalizeSingleWorkspacePackageContribution({ packageName: 'flows', value: { version: 1, view: '../unsafe' } }), null);
});

test('publishes the v2 initial canvas composition from the package manifest', () => {
  const entry = normalizeSingleWorkspacePackageContribution({
    packageName: 'flows', packageLabel: 'Flows', value: {
      version: 2, view: 'Editor', components: [{ id: 'editor', view: 'Editor', position: { x: 0, y: 0 }, size: { width: 880, height: 620 } }],
    },
  });
  assert.deepEqual(entry.singleWorkspace.components, [{ id: 'editor', view: 'Editor', position: { x: 0, y: 0 }, size: { width: 880, height: 620 } }]);
  assert.equal(normalizeSingleWorkspacePackageContribution({
    packageName: 'flows', value: { version: 2, view: 'Editor', components: [{ id: '../unsafe', view: 'Editor' }] },
  }), null);
});

test('publishes a v4 workspace template so the Desktop can open it', () => {
  const entry = normalizeSingleWorkspacePackageContribution({
    packageName: 'flows', packageLabel: 'Flows', value: {
      version: 4, view: 'FlowCanvas', presentation: 'workspaceTemplate',
      components: [{ id: 'canvas', role: 'canvas', view: 'FlowCanvas', position: { x: 0, y: 0 }, size: { width: 900, height: 600 } }],
    },
  });
  assert.equal(entry.singleWorkspace.version, 4);
  assert.equal(entry.singleWorkspace.presentation, 'workspaceTemplate');
  assert.equal(entry.singleWorkspace.url, '/view/flows/FlowCanvas');
});

test('publishes v5 native canvas views without a parallel workspace host', () => {
  const entry = normalizeSingleWorkspacePackageContribution({
    packageName: 'flows', packageLabel: 'Flows', value: {
      version: 5, view: 'FlowCanvas', presentation: 'nativeCanvas',
      components: [{ id: 'canvas', role: 'canvas', view: 'FlowCanvas', mode: 'surface', position: { x: 0, y: 0 }, size: { width: 900, height: 600 } }],
    },
  });
  assert.equal(entry.singleWorkspace.presentation, 'nativeCanvas');
  assert.equal(entry.singleWorkspace.components[0].mode, 'surface');
});

test('publishes a bounded declarative create action for a workspace that needs an item', () => {
  const entry = normalizeSingleWorkspacePackageContribution({
    packageName: 'flows', packageLabel: 'Flows', value: {
      version: 5, view: 'FlowCanvas', presentation: 'nativeCanvas',
      create: { path: '/flows/workflows', method: 'POST', response: 'workflow' },
      components: [{ id: 'canvas', view: 'FlowCanvas', mode: 'surface', position: {}, size: {} }],
    },
  });
  assert.deepEqual(entry.singleWorkspace.create, { path: '/flows/workflows', method: 'POST', response: 'workflow' });
  assert.equal(normalizeSingleWorkspacePackageContribution({
    packageName: 'flows', value: { version: 5, view: 'FlowCanvas', create: { path: '/other/items' }, components: [{ id: 'canvas', view: 'FlowCanvas' }] },
  }), null);
});
