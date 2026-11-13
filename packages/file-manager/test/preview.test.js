import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { compile } from 'svelte/compiler';

import { resolveViewer } from '../index.js';
import { readSpreadsheet } from '../lib/spreadsheet.js';
import { FILE_MANAGER_PREVIEW_EVENT, filePreviewUrl, normalizeFilePreview, openFilePreview } from '../views/lib/protocol.js';
import { renderMarkdown } from '../views/lib/markdown.js';
import { FILE_PICKER_REQUEST, FILE_PICKER_SELECTED, FILE_PICKER_CANCELLED, filePickerProviderClientScript } from '../hooks/file-picker-provider.js';

const packageDir = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

test('protocol creates an internal route and rejects absolute or parent paths', () => {
  assert.equal(FILE_MANAGER_PREVIEW_EVENT, 'file-manager:preview');
  assert.deepEqual(normalizeFilePreview({ path: 'uploads/report.pdf', type: 'application/pdf' }), {
    path: 'uploads/report.pdf',
    name: 'report.pdf',
    type: 'application/pdf',
    title: 'report.pdf',
  });
  assert.equal(filePreviewUrl({ path: 'uploads/report.pdf', name: 'Q4 report.pdf' }), '/view/file-manager/Preview?path=uploads%2Freport.pdf&name=Q4+report.pdf');
  assert.equal(normalizeFilePreview({ path: '../secret.txt' }), null);
  assert.equal(normalizeFilePreview({ path: '/etc/passwd' }), null);
  let message;
  assert.equal(openFilePreview({ path: 'uploads/report.pdf' }, { postMessage: (value) => { message = value; } }), true);
  assert.equal(message.type, FILE_MANAGER_PREVIEW_EVENT);
  assert.equal(message.detail.path, 'uploads/report.pdf');
});

test('native registry resolves requested previews inside file-manager', () => {
  const cases = [
    ['report.pdf', 'PdfView'],
    ['photo.webp', 'ImageView'],
    ['movie.mp4', 'VideoView'],
    ['movie-without-mime.glb', 'GlbView'],
    ['notes.txt', 'TextView'],
    ['table.csv', 'SpreadsheetView'],
    ['workbook.xlsx', 'SpreadsheetView'],
  ];
  for (const [path, component] of cases) {
    const result = resolveViewer({ path });
    assert.equal(result.success, true);
    assert.equal(result.pkg, 'file-manager');
    assert.equal(result.component, component);
    assert.match(result.url, /^\/view\/file-manager\//);
  }
});

test('native image previews cover common browser image extensions regardless of case', () => {
  for (const path of ['photo.jpg', 'logo.SVG', 'screenshot.png', 'cover.webp', 'camera.JFIF', 'animation.apng']) {
    const result = resolveViewer({ path });
    assert.equal(result.success, true, path);
    assert.equal(result.pkg, 'file-manager', path);
    assert.equal(result.component, 'ImageView', path);
  }
});

test('file manager and preview views compile for DOM and SSR', () => {
  for (const name of ['Index', 'Picker', 'Preview', 'PreviewName', 'PdfView', 'SpreadsheetView', 'ImageView', 'VideoView', 'AudioView', 'GlbView', 'TextView', 'MarkdownView']) {
    const filename = join(packageDir, 'views', `${name}.svelte`);
    const source = readFileSync(filename, 'utf8');
    assert.ok(compile(source, { filename, generate: 'dom' }).js.code);
    assert.ok(compile(source, { filename, generate: 'ssr' }).js.code);
  }
});

test('File Manager provides the Lógos file-picker browser protocol', () => {
  assert.equal(FILE_PICKER_REQUEST, 'logos:file-picker:request');
  assert.equal(FILE_PICKER_SELECTED, 'logos:file-picker:selected');
  assert.equal(FILE_PICKER_CANCELLED, 'logos:file-picker:cancelled');
  const provider = filePickerProviderClientScript();
  assert.match(provider, /view\/file-manager\/Picker/);
  assert.match(provider, /DataTransfer/);
  const picker = readFileSync(join(packageDir, 'views', 'FilePicker.svelte'), 'utf8');
  assert.match(picker, /data-logos-native-file-picker/);
});

test('uploads use the file-manager multipart endpoint after the package rename', () => {
  const api = readFileSync(join(packageDir, 'views', 'lib', 'api.js'), 'utf8');
  const service = readFileSync(join(packageDir, 'index.js'), 'utf8');
  assert.match(api, /fetch\('\/file-manager\/upload', \{ method: 'POST', body: formData \}\)/);
  assert.doesNotMatch(api, /file-manage\/upload/);
  assert.match(service, /@register_router upload/);
  assert.match(service, /@upload files 500 1gb memory/);
});

test('GLB preview renders in SSR without browser animation APIs', async () => {
  const logos = join(packageDir, '..', '..', '..', '..', 'packages', 'logos', 'dist', 'src', 'modules', 'views', 'engine.js');
  const engineModule = await import(pathToFileURL(logos).href);
  const { SvelteEngine } = engineModule.default ?? engineModule;
  const cache = mkdtempSync(join(tmpdir(), 'file-manager-glb-ssr-'));
  const workspace = join(packageDir, '..');
  const html = await new SvelteEngine(cache).render(
    join(packageDir, 'views', 'GlbView.svelte'),
    'file_manager__GlbView_ssr_test',
    { path: 'uploads/example.glb' },
    workspace,
  );
  assert.match(html, /3D model: example\.glb/);
});

test('unknown text previews render in SSR without browser APIs', async () => {
  const logos = join(packageDir, '..', '..', '..', '..', 'packages', 'logos', 'dist', 'src', 'modules', 'views', 'engine.js');
  const engineModule = await import(pathToFileURL(logos).href);
  const { SvelteEngine } = engineModule.default ?? engineModule;
  const cache = mkdtempSync(join(tmpdir(), 'file-manager-text-ssr-'));
  const workspace = join(packageDir, '..');
  const html = await new SvelteEngine(cache).render(
    join(packageDir, 'views', 'Preview.svelte'),
    'file_manager__Preview_unknown_text_ssr_test',
    { path: 'uploads/example.unkwn', name: 'example.unkwn' },
    workspace,
  );
  assert.match(html, /example\.unkwn/);
});

test('Markdown previews use the dedicated safe renderer', () => {
  const preview = readFileSync(join(packageDir, 'views', 'Preview.svelte'), 'utf8');
  const markdown = readFileSync(join(packageDir, 'views', 'MarkdownView.svelte'), 'utf8');
  const html = renderMarkdown('# Title\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))');
  assert.match(preview, /MARKDOWN_EXTENSIONS/);
  assert.match(preview, /MarkdownView/);
  assert.match(markdown, /renderMarkdown/);
  assert.match(markdown, /markdown-body/);
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<table>/);
  assert.doesNotMatch(html, /<script|javascript:/);
});

test('GLB renders internally and previews follow the canonical theme', () => {
  const glb = readFileSync(join(packageDir, 'views', 'GlbView.svelte'), 'utf8');
  const theme = readFileSync(join(packageDir, 'views', 'lib', 'theme.js'), 'utf8');
  assert.match(glb, /GLTFLoader/);
  assert.match(glb, /OrbitControls/);
  assert.match(glb, /WebGLRenderer/);
  assert.match(theme, /agent:theme/);
  assert.doesNotMatch(theme, /think:theme/);
});

test('viewers keep previews internal and only expose raw files as downloads', () => {
  for (const name of ['PdfView', 'ImageView', 'VideoView', 'AudioView', 'GlbView', 'TextView', 'MarkdownView']) {
    const source = readFileSync(join(packageDir, 'views', `${name}.svelte`), 'utf8');
    assert.doesNotMatch(source, /target=["']_blank["']/);
    assert.match(source, /download=\{name\}/);
  }
});

test('image preview gives feedback while loading and identifies the displayed image', () => {
  const source = readFileSync(join(packageDir, 'views', 'ImageView.svelte'), 'utf8');
  assert.match(source, /Loading image/);
  assert.match(source, /Image: \$\{name\}/);
  assert.match(source, /naturalWidth/);
  assert.match(source, /figcaption/);
});

test('explorer uses image thumbnails for every built-in image extension', () => {
  const explorer = readFileSync(join(packageDir, 'views', 'Index.svelte'), 'utf8');
  for (const ext of ['.jpg', '.svg', '.png', '.webp', '.jfif', '.apng']) {
    assert.match(explorer, new RegExp(`'${ext.replace('.', '\\.')}'`));
  }
  assert.match(explorer, /fm-tile-thumb/);
});

test('the preview name copies the full path', () => {
  const source = readFileSync(join(packageDir, 'views', 'PreviewName.svelte'), 'utf8');
  assert.match(source, /navigator\.clipboard\.writeText\(path\)/);
  assert.match(source, /Copy path:/);
});

test('explorer clipboard follows the standard copy, choose destination, paste flow', () => {
  const explorer = readFileSync(join(packageDir, 'views', 'Index.svelte'), 'utf8');
  const service = readFileSync(join(packageDir, 'index.js'), 'utf8');
  assert.match(explorer, /Choose a folder, then paste/);
  assert.match(explorer, /Paste here/);
  assert.match(explorer, /Paste into “\{contextMenu\.entry\.name\}”/);
  assert.match(explorer, /Ctrl\+C/);
  assert.match(explorer, /Ctrl\+X/);
  assert.match(explorer, /Ctrl\+V/);
  assert.match(service, /Cannot paste a folder into itself/);
});

test('Artifacts and Shell use the internal protocol instead of opening files externally', () => {
  const shell = readFileSync(join(packageDir, '..', 'shell', 'views', 'Index.svelte'), 'utf8');
  assert.match(shell, /busOn\(FILE_MANAGER_PREVIEW_EVENT, \(d\) => abrirPreviewNoFileManager\(d\)\)/);
  assert.match(shell, /pkg: "file-manager"/);

  // Todas as superfícies de artefatos delegam o preview ao Shell. A biblioteca
  // global abre a prévia em uma aba interna, sem criar aba do navegador.
  for (const name of ['Index', 'SessionArtifacts', 'ArtifactDetail', 'Widget']) {
    const source = readFileSync(join(packageDir, '..', 'artifacts', 'views', `${name}.svelte`), 'utf8');
    assert.match(source, /openFilePreview/);
    assert.doesNotMatch(source, /window\.open\(artifact\.url/);
  }

  const library = readFileSync(join(packageDir, '..', 'artifacts', 'views', 'Index.svelte'), 'utf8');
  assert.doesNotMatch(library, /target="_blank"/);
  assert.match(library, /artifacts:viewMode/);
});

test('parser reads CSV with quoted fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'file-manager-csv-'));
  const path = join(dir, 'report.csv');
  writeFileSync(path, 'name,value\n"North, region",42\n', 'utf8');
  const result = readSpreadsheet(path);
  assert.deepEqual(result.sheets[0].rows, [['name', 'value'], ['North, region', '42']]);
});

test('parser reads the first worksheet from an XLSX', () => {
  const dir = mkdtempSync(join(tmpdir(), 'file-manager-xlsx-'));
  const path = join(dir, 'report.xlsx');
  const zip = new AdmZip();
  zip.addFile('xl/workbook.xml', Buffer.from('<workbook xmlns:r="r"><sheets><sheet name="Results" sheetId="1" r:id="rId1"/></sheets></workbook>'));
  zip.addFile('xl/_rels/workbook.xml.rels', Buffer.from('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'));
  zip.addFile('xl/sharedStrings.xml', Buffer.from('<sst><si><t>Name</t></si><si><t>Aurora</t></si></sst>'));
  zip.addFile('xl/worksheets/sheet1.xml', Buffer.from('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>7</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c></row></sheetData></worksheet>'));
  zip.writeZip(path);
  const result = readSpreadsheet(path);
  assert.equal(result.sheets[0].name, 'Results');
  assert.deepEqual(result.sheets[0].rows, [['Name', '7'], ['Aurora']]);
});
