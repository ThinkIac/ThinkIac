import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FAVORITE_SESSIONS_KEY,
  readFavoriteSessions,
  toggleFavoriteSession,
  writeFavoriteSessions,
} from './favorite_sessions.js';

function storageWith(value = null) {
  const values = new Map(value === null ? [] : [[FAVORITE_SESSIONS_KEY, value]]);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, next) => values.set(key, next),
  };
}

test('favorite sessions ignore invalid storage and persist unique ids', () => {
  assert.deepEqual(readFavoriteSessions(storageWith('{invalid')), []);
  assert.deepEqual(readFavoriteSessions(storageWith(JSON.stringify(['a', 'a', '', 3]))), ['a']);

  const storage = storageWith();
  writeFavoriteSessions(['a', 'b'], storage);
  assert.deepEqual(readFavoriteSessions(storage), ['a', 'b']);
});

test('favorite session toggle adds and removes the session id', () => {
  assert.deepEqual(toggleFavoriteSession([], 'orbit-1'), ['orbit-1']);
  assert.deepEqual(toggleFavoriteSession(['orbit-1'], 'orbit-1'), []);
});
