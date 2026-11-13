import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveEntryView, resolveViewSource } from '../src/modules/views';
import { bootstrap, isPublicView } from '../src/index';
import { makeWorkspace } from './helpers';

describe('.public.svelte views', () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => { await Promise.all(closers.splice(0).map(close => close())); });

  it('serves a public suffix through the clean page name and never through .public', () => {
    const workspace = makeWorkspace('logos-public-view-');
    try {
      const dir = workspace.pkg('landing', {
        'package.json': JSON.stringify({ name: 'landing' }),
        'views/Index.Public.svelte': '<p>public</p>',
      });
      const views = path.join(dir, 'views');

      expect(resolveViewSource(views, 'Index', false)).toMatchObject({ file: 'Index.Public.svelte', public: true });
      expect(resolveViewSource(views, 'Index.public', false)).toBeNull();
    } finally {
      workspace.cleanup();
    }
  });

  it('prefers a private page for an authenticated request, but preserves the public fallback', () => {
    const workspace = makeWorkspace('logos-public-view-priority-');
    try {
      const dir = workspace.pkg('landing', {
        'package.json': JSON.stringify({ name: 'landing' }),
        'views/Index.svelte': '<p>private</p>',
        'views/Index.public.svelte': '<p>public</p>',
      });
      const views = path.join(dir, 'views');

      expect(resolveViewSource(views, 'Index', false)).toMatchObject({ file: 'Index.public.svelte', public: true });
      expect(resolveViewSource(views, 'Index', true)).toMatchObject({ file: 'Index.svelte', public: false });
    } finally {
      workspace.cleanup();
    }
  });

  it('chooses Index then Home for public visitors and private sessions', () => {
    const workspace = makeWorkspace('logos-public-view-entry-');
    try {
      const dir = workspace.pkg('landing', {
        'package.json': JSON.stringify({ name: 'landing' }),
        'views/Index.public.svelte': '<p>public index</p>',
        'views/Home.svelte': '<p>private home</p>',
        'views/Home.public.svelte': '<p>public home</p>',
      });
      const views = path.join(dir, 'views');

      expect(resolveEntryView(views, false)).toMatchObject({ page: 'Index', file: 'Index.public.svelte', public: true });
      expect(resolveEntryView(views, true)).toMatchObject({ page: 'Home', file: 'Home.svelte', public: false });
    } finally {
      workspace.cleanup();
    }
  });

  it('exposes only clean public view URLs, including the package entry URL', async () => {
    const workspace = makeWorkspace('logos-public-view-registry-');
    workspace.pkg('landing', {
      'package.json': JSON.stringify({ name: 'landing' }),
      'views/Index.public.svelte': '<p>public</p>',
      'views/Home.svelte': '<p>private</p>',
    });
    const instance = await bootstrap({ workspace: workspace.root, port: false });
    closers.push(async () => { await instance.close(); workspace.cleanup(); });

    expect(isPublicView('/view/landing')).toBe(true);
    expect(isPublicView('/view/landing/Index')).toBe(true);
    expect(isPublicView('/view/landing/Index.public')).toBe(false);
    expect(isPublicView('/view/landing/Home')).toBe(false);
  });

});
