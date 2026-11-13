const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createProfile, renameProfile, deleteProfile, listProfiles } = require('.');

const PROFILES_DIR = path.join(__dirname, 'profiles');
const TRASH_DIR = path.join(PROFILES_DIR, '.trash');

// Nomes exclusivos deste processo: os testes mexem no diretório de perfis real
// (é o que a rota usa), então não podem colidir com um perfil de verdade.
const TAG = `test-${process.pid}`;

function cleanup() {
  for (const name of fs.readdirSync(PROFILES_DIR)) {
    if (name.startsWith(TAG)) fs.rmSync(path.join(PROFILES_DIR, name), { recursive: true, force: true });
  }
  if (fs.existsSync(TRASH_DIR)) {
    for (const name of fs.readdirSync(TRASH_DIR)) {
      if (name.startsWith(TAG)) fs.rmSync(path.join(TRASH_DIR, name), { recursive: true, force: true });
    }
  }
}

test.afterEach(cleanup);

test('createProfile cria o $HOME e passa a listar o perfil', () => {
  const name = `${TAG}-novo`;
  const result = createProfile(name);
  assert.equal(result.profileId, name);
  assert.ok(fs.statSync(path.join(PROFILES_DIR, name)).isDirectory());
  assert.ok(result.profiles.includes(name));
  assert.ok(listProfiles().includes(name));
});

test('createProfile recusa nome inválido e perfil repetido', () => {
  assert.throws(() => createProfile('../escapa'), /nome inválido/);
  assert.throws(() => createProfile('com espaço'), /nome inválido/);
  assert.throws(() => createProfile(''), /nome inválido/);
  const name = `${TAG}-dup`;
  createProfile(name);
  assert.throws(() => createProfile(name), /já existe/);
});

test('renameProfile move o diretório preservando o conteúdo', () => {
  const from = `${TAG}-antes`;
  const to = `${TAG}-depois`;
  createProfile(from);
  fs.writeFileSync(path.join(PROFILES_DIR, from, 'marca.txt'), 'credencial');

  const result = renameProfile(from, to);
  assert.equal(result.profileId, to);
  assert.equal(fs.existsSync(path.join(PROFILES_DIR, from)), false);
  assert.equal(fs.readFileSync(path.join(PROFILES_DIR, to, 'marca.txt'), 'utf8'), 'credencial');
});

test('renameProfile protege o default e recusa sobrescrever perfil existente', () => {
  const a = `${TAG}-a`;
  const b = `${TAG}-b`;
  createProfile(a);
  createProfile(b);
  assert.throws(() => renameProfile('default', `${TAG}-x`), /não pode ser renomeado/);
  assert.throws(() => renameProfile(a, b), /já existe/);
  assert.throws(() => renameProfile(`${TAG}-inexistente`, `${TAG}-x`), /não existe/);
});

test('deleteProfile manda para a lixeira em vez de apagar, e nunca toca no default', () => {
  const name = `${TAG}-lixo`;
  createProfile(name);
  fs.writeFileSync(path.join(PROFILES_DIR, name, 'marca.txt'), 'credencial');

  const result = deleteProfile(name);
  assert.equal(result.profileId, name);
  assert.equal(fs.existsSync(path.join(PROFILES_DIR, name)), false);
  assert.equal(listProfiles().includes(name), false);
  // O $HOME continua no disco, sob .trash, para resgate manual.
  assert.equal(fs.readFileSync(path.join(result.trashed, 'marca.txt'), 'utf8'), 'credencial');

  assert.throws(() => deleteProfile('default'), /não pode ser apagado/);
  assert.throws(() => deleteProfile(`${TAG}-inexistente`), /não existe/);
});

test('a lixeira não aparece na listagem de perfis', () => {
  createProfile(`${TAG}-some`);
  deleteProfile(`${TAG}-some`);
  assert.equal(listProfiles().some(p => p.startsWith('.')), false);
});
