#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';

const ROOT = resolve(process.cwd(), 'packages');
const PACKAGE_TEMPLATE = {
  name: '',
  version: '1.0.0',
  type: 'module',
  main: 'index.js',
  description: '',
  private: true,
  engines: { node: '>=20' },
  scripts: {
    test: 'node --test',
    check: 'node --check index.js'
  },
  classification: {
    examples: []
  },
  manifest: {
    name: '',
    launch: false,
    iconPreset: { pack: 'lucide', name: 'Package' },
    inputbar: {
      id: '',
      kind: 'action',
      label: '',
      hint: '',
      view: false,
      event: '',
      availability: ''
    }
  }
};

const CI_GITHUB_WORKFLOW = `name: CI and release

on:
  push:
    branches: [ main ]
    tags: [ 'v*' ]
  pull_request:
    branches: [ main ]

permissions:
  contents: write

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install --ignore-scripts
      - run: npm run check
      - run: npm test
      - name: Build installable ZIP
        if: startsWith(github.ref, 'refs/tags/v')
        run: zip -r "package-\${{ github.ref_name }}.zip" . -x '.git/*' 'node_modules/*'
      - name: Publish GitHub release
        if: startsWith(github.ref, 'refs/tags/v')
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
          files: package-*.zip
`;

const INDEX_TEMPLATE = `// {NAME} - ThinkIac package
// Estrutura válida gerada por engineer:createPackage

export async function init({ context } = {}) {
  console.log('[{NAME}] inicializado');
  return { name: '{NAME}', status: 'ok' };
}

export default { init };
`;

const README_TEMPLATE = `# {NAME}

Pacote ThinkIac gerado por \`engineer:createPackage\`.

## Estrutura

- \`package.json\` — manifesto do pacote
- \`index.js\` — ponto de entrada
- \`README.md\` — esta documentação
- \`.github/workflows/ci.yml\` — integração contínua

## Uso

\`\`\`js
import { init } from './packages/{NAME}/index.js';

await init({ context });
\`\`\`

## CI

O pacote inclui um workflow do GitHub que roda \`npm run check\` e \`npm test\` em cada push e pull request.
`;

function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function pascalCase(name) {
  return String(name)
    .split(/[-_\\s]+/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function ensureDir(path) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function writeFile(path, content) {
  ensureDir(dirname(path));
  writeFileSync(path, content, 'utf8');
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(path, obj) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

async function createPackage(fullName) {
  try {
    const slug = slugify(fullName);
    const display = pascalCase(fullName);
    const pkgDir = join(ROOT, slug);

    if (existsSync(pkgDir)) {
      console.error(`Erro: o pacote "${slug}" já existe em ${pkgDir}`);
      process.exit(1);
    }

    ensureDir(pkgDir);

    const manifest = { ...PACKAGE_TEMPLATE };
    manifest.name = slug;
    manifest.description = `Pacote ThinkIac: ${display}`;
    manifest.manifest.name = display;
    manifest.manifest.inputbar.id = `engineer:${slug}`;
    manifest.manifest.inputbar.label = display;
    manifest.manifest.inputbar.hint = `Pacote ${display} gerado por engineer:createPackage`;
    manifest.manifest.inputbar.event = `engineer:${slug}:open`;
    manifest.manifest.inputbar.availability = `/engineer/${slug}`;

    writeJson(join(pkgDir, 'package.json'), manifest);
    writeFile(join(pkgDir, 'index.js'), INDEX_TEMPLATE.replaceAll('{NAME}', fullName));
    writeFile(join(pkgDir, 'README.md'), README_TEMPLATE.replaceAll('{NAME}', fullName));

    const ciDir = join(pkgDir, '.github', 'workflows');
    ensureDir(ciDir);
    writeFile(join(ciDir, 'ci.yml'), CI_GITHUB_WORKFLOW);

    console.log(`Pacote "${slug}" criado com sucesso em ${pkgDir}`);
    console.log('Estrutura:');
    console.log(`  ${slug}/`);
    console.log(`    package.json`);
    console.log(`    index.js`);
    console.log(`    README.md`);
    console.log(`    .github/workflows/ci.yml`);
  } catch (err) {
    console.error(`Falha ao criar pacote: ${err.message}`);
    process.exit(1);
  }
}

async function validityPackage(fullName, applyAjusts) {
  try {
    const slug = slugify(fullName);
    const pkgDir = join(ROOT, slug);

    if (!existsSync(pkgDir)) {
      console.error(`Erro: o pacote "${slug}" não existe em ${pkgDir}`);
      process.exit(1);
    }

    const issues = [];
    const fixes = [];

    // 1. package.json válido
    const pkgPath = join(pkgDir, 'package.json');
    let pkg = readJson(pkgPath);
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
      issues.push('package.json inválido ou ausente');
      pkg = {};
    }

    if (!pkg || !pkg.name) {
      issues.push('package.json: campo "name" ausente');
      if (applyAjusts) { pkg.name = slug; fixes.push('Adicionado "name" ao package.json'); }
    }
    if (!pkg || !pkg.version) {
      issues.push('package.json: campo "version" ausente');
      if (applyAjusts) { pkg.version = '1.0.0'; fixes.push('Adicionado "version" ao package.json'); }
    }
    if (!pkg || !pkg.main) {
      issues.push('package.json: campo "main" ausente');
      if (applyAjusts) { pkg.main = 'index.js'; fixes.push('Adicionado "main" ao package.json'); }
    }

    // 2. index.js existe
    const indexPath = join(pkgDir, 'index.js');
    if (!existsSync(indexPath)) {
      issues.push('index.js ausente');
      if (applyAjusts) {
        writeFile(indexPath, INDEX_TEMPLATE.replaceAll('{NAME}', fullName));
        fixes.push('Criado index.js');
      }
    }

    // 3. CI existe
    const ciPath = join(pkgDir, '.github', 'workflows', 'ci.yml');
    if (!existsSync(ciPath)) {
      issues.push('CI ausente: .github/workflows/ci.yml não encontrado');
      if (applyAjusts) {
        ensureDir(dirname(ciPath));
        writeFile(ciPath, CI_GITHUB_WORKFLOW);
        fixes.push('Criado .github/workflows/ci.yml');
      }
    }

    // 4. README existe
    const readmePath = join(pkgDir, 'README.md');
    if (!existsSync(readmePath)) {
      issues.push('README.md ausente');
      if (applyAjusts) {
        writeFile(readmePath, README_TEMPLATE.replaceAll('{NAME}', fullName));
        fixes.push('Criado README.md');
      }
    }

    if (applyAjusts && fixes.length > 0) {
      if (pkg && (pkg.name || pkg.version || pkg.main)) {
        writeJson(pkgPath, pkg);
      }
    }

    console.log(`=== Validação do pacote "${slug}" ===`);
    console.log(`Diretório: ${pkgDir}`);

    if (applyAjusts && fixes.length > 0) {
      console.log(`Status após ajustes: VÁLIDO — ${fixes.length} ajuste(s) aplicado(s).`);
      return;
    }

    if (issues.length === 0) {
      console.log('Status: VÁLIDO — todos os requisitos atendidos.');
    } else {
      console.log(`Status: INVÁLIDO — ${issues.length} problema(s) encontrado(s):`);
      for (const issue of issues) {
        console.log(`  - ${issue}`);
      }
    }

    if (applyAjusts) {
      if (fixes.length > 0) {
        console.log('\nAjustes aplicados:');
        for (const fix of fixes) {
          console.log(`  + ${fix}`);
        }
      } else {
        console.log('\nNenhum ajuste necessário.');
      }
    }

    process.exit(issues.length > 0 ? 1 : 0);
  } catch (err) {
    console.error(`Falha na validação: ${err.message}`);
    process.exit(1);
  }
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const command = args[0];
    const fullName = args[1];
    const applyAjusts = args.includes('--applyAjusts');

    if (!command) {
      console.log('Uso:');
      console.log('  npx think engineer:createPackage <nome>');
      console.log('  npx think engineer:validityPackage <nome> [--applyAjusts]');
      process.exit(1);
    }

    if (command === 'engineer:createPackage') {
      if (!fullName) {
        console.error('Erro: informe o nome do pacote.');
        console.log('Uso: npx think engineer:createPackage <nome>');
        process.exit(1);
      }
      await createPackage(fullName);
    } else if (command === 'engineer:validityPackage' || command === 'engineer:validatePackage') {
      if (!fullName) {
        console.error('Erro: informe o nome do pacote.');
        console.log('Uso: npx think engineer:validityPackage <nome> [--applyAjusts]');
        process.exit(1);
      }
      await validityPackage(fullName, applyAjusts);
    } else {
      console.error(`Comando desconhecido: ${command}`);
      process.exit(1);
    }
  } catch (err) {
    console.error('Erro inesperado:', err.message);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Erro inesperado:', err.message);
  process.exit(1);
});
