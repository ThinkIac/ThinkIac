import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { compile } from 'svelte/compiler';

const publicLoginView = new URL('./views/Login.public.svelte', import.meta.url);

test('Login has a public view entry that delegates to the existing login flow', async () => {
    const source = await readFile(publicLoginView, 'utf8');

    assert.match(source, /import Login from '\.\/Login\.svelte';/);
    assert.match(source, /<Login\s*\/>/);
    assert.doesNotThrow(() => compile(source, { generate: 'ssr' }));
});

test('Login has no public administrator setup', async () => {
    const source = await readFile(new URL('./views/Login.svelte', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /auth\/initial-admin|Create the first administrator/);
    assert.doesNotThrow(() => compile(source, { generate: 'ssr' }));
});
