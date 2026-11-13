import assert from 'node:assert/strict';
import test from 'node:test';
import {
    appDestination,
    distributedApp,
    provisioningMode,
    pathBelongsToApp,
    tenantPluginsFor,
} from './app_flow.js';

test('only allowlisted distributed apps are accepted', () => {
    assert.equal(distributedApp({ flow: 'app', app: 'lectio' })?.slug, 'lectio');
    assert.equal(distributedApp({ flow: 'app', app: 'terminal' }), null);
    assert.equal(distributedApp({ flow: 'other', app: 'lectio' }), null);
});

test('Lectio acquisition defers tenant provisioning and has one stable destination', () => {
    assert.equal(provisioningMode('lectio'), 'deferred');
    assert.equal(provisioningMode(null), 'immediate');
    assert.equal(appDestination('lectio'), '/auth/apps/lectio/enter');
});

test('a future tenant receives every entitled distributed package', () => {
    assert.deepEqual(tenantPluginsFor(['lectio', 'unknown', 'lectio']), ['ocr', 'lectio']);
});

test('the entitlement covers both the Lectio view and API, never another package', () => {
    assert.equal(pathBelongsToApp('/view/lectio/Reader', 'lectio'), true);
    assert.equal(pathBelongsToApp('/lectio/api/documents', 'lectio'), true);
    assert.equal(pathBelongsToApp('/terminal/ws', 'lectio'), false);
});
