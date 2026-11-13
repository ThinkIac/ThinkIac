import assert from 'node:assert/strict';
import {
  FAVORITE_APPS_KEY,
  favoriteAppId,
  readFavoriteApps,
  sortAppsWithFavorites,
  toggleFavoriteApp,
  writeFavoriteApps,
} from './favorite_apps.js';

const values = new Map();
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
};
const apps = [
  { id: 'z-id', packageName: 'zeta', name: 'Zeta' },
  { id: 'a-id', packageName: 'alpha', name: 'Alpha' },
  { id: 'b-id', packageName: 'beta', name: 'Beta' },
];

assert.equal(favoriteAppId(apps[0]), 'zeta');
assert.deepEqual(sortAppsWithFavorites(apps, []).map((app) => app.name), ['Alpha', 'Beta', 'Zeta']);

let favorites = toggleFavoriteApp([], apps[0]);
assert.deepEqual(favorites, ['zeta']);
assert.deepEqual(sortAppsWithFavorites(apps, favorites).map((app) => app.name), ['Zeta', 'Alpha', 'Beta']);

writeFavoriteApps(favorites, storage);
assert.equal(values.get(FAVORITE_APPS_KEY), '["zeta"]');
assert.deepEqual(readFavoriteApps(storage), ['zeta']);
assert.deepEqual(toggleFavoriteApp(favorites, apps[0]), []);

values.set(FAVORITE_APPS_KEY, '{invalid');
assert.deepEqual(readFavoriteApps(storage), []);
