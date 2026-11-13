import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const view = readFileSync(fileURLToPath(new URL('../views/Index.svelte', import.meta.url)), 'utf8');

test('Packages presents only the local package list', () => {
  assert.match(view, /\$\{BASE\}\/packages/);
  assert.match(view, /package-list/);
  assert.doesNotMatch(view, /Discover|Registry|publish|Publish|workspace/i);
});

test('search filters the local collection and remains usable on narrow screens', () => {
  assert.match(view, /visiblePackages = packages\.filter/);
  assert.match(view, /type="search"/);
  assert.match(view, /enterkeyhint="search"/);
  assert.match(view, /min-width:0/);
  assert.match(view, /@media \(max-width:680px\)/);
});

test('library preserves safe activation and removal controls', () => {
  assert.match(view, /pkg\.status === 'disabled'/);
  assert.match(view, /Choose version/);
  assert.match(view, /Confirm removal/);
  assert.match(view, /const enable/);
  assert.match(view, /const disable/);
  assert.match(view, /await refresh\(\)/);
  assert.match(view, /as pkg \(pkg\.name\)/);
});

test('active and disabled filters support bulk lifecycle actions', () => {
  assert.match(view, /selectedNames/);
  assert.match(view, /toggleAllVisible/);
  assert.match(view, /runBulkAction/);
  assert.match(view, /Disable selected/);
  assert.match(view, /Enable selected/);
  assert.match(view, /bulk-dock/);
  assert.match(view, /position:fixed/);
});

test('package rows select directly and preserve system action alignment', () => {
  assert.match(view, /function selectFromRow/);
  assert.match(view, /on:click=\{event => selectFromRow\(event, pkg\)\}/);
  assert.doesNotMatch(view, /class="package-check"/);
  assert.match(view, /pkg\.protected\}<button class="secondary" disabled/);
});

test('all lifecycle filters group packages by types in the Artifacts visual identity', () => {
  assert.match(view, /availableTags = \['System', 'Others'/);
  assert.match(view, /tagFilter === 'all'/);
  assert.match(view, /class="type-filter"/);
  assert.match(view, /<option value="all">ALL Types<\/option>/);
  assert.match(view, /aria-label="Filter by package type"/);
  assert.match(view, /label: tag/);
  assert.match(view, /group\.packages as pkg/);
  assert.match(view, /\.package-row \{[^}]*margin:0 0 6px/);
  assert.match(view, /--bg:#111111/);
  assert.match(view, /Ubuntu/);
  assert.match(view, /class="package-meta"/);
});

test('packages support Artifact-style grid and list views with truncated descriptions', () => {
  assert.match(view, /let theme = .*viewMode = 'list'/);
  assert.match(view, /function setViewMode\(mode\)/);
  assert.match(view, /class="view-switch" aria-label="View mode"/);
  assert.match(view, /aria-label="Grid view"/);
  assert.match(view, /aria-label="List view"/);
  assert.match(view, /class:package-grid=\{viewMode === 'grid'\}/);
  assert.match(view, /class:package-card=\{viewMode === 'grid'\}/);
  assert.match(view, /-webkit-line-clamp:2/);
});

test('all tag groups can be collapsed without hiding lifecycle filters', () => {
  assert.match(view, /let failedIcons = \{\}, collapsedTags = \{\}/);
  assert.match(view, /function toggleTagGroup/);
  assert.match(view, /filter === 'all' && toggleTagGroup\(group\.label\)/);
  assert.match(view, /collapsedTags\[group\.label\]/);
});

test('package icon falls back to the package initial', () => {
  assert.match(view, /function packageInitial/);
  assert.match(view, /class="app-icon-initial">\{packageInitial\(pkg\)\}/);
  assert.match(view, /on:error=\{\(\) => markIconFailed\(pkg\.name\)\}/);
});

test('view follows the Runtime theme contract without Aurora legacy state', () => {
  assert.match(view, /localStorage\.getItem\('think:theme'\)/);
  assert.match(view, /addEventListener\('think:theme-changed'/);
  assert.doesNotMatch(view, /aurora:theme/);
});
