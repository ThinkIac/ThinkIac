import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPermissionCatalog, listSelectablePermissions, validateDeclaredGroupInput } from './permission_catalog.cjs';

function packageManifest(root, name, manifest) {
    const folder = join(root, name);
    mkdirSync(folder);
    writeFileSync(join(folder, 'package.json'), JSON.stringify({ name, version: '1.0.0', manifest }));
}

test('discovers valid permission groups declared by installed packages', () => {
    const root = mkdtempSync(join(tmpdir(), 'thinkiac-permissions-'));
    try {
        packageManifest(root, 'email-manager', {
            permissionGroups: [{
                id: 'operator', label: 'Operador',
                permissions: ['email-manager.mailbox.read', 'email-manager.mailbox.write'],
            }],
        });
        packageManifest(root, 'invalid-package', {
            permissionGroups: [{ id: 'broken id', permissions: ['../root'] }],
        });

        const catalog = createPermissionCatalog({ packagesDir: root });
        assert.deepEqual(catalog.list(), [{
            packageName: 'email-manager',
            packageLabel: 'email-manager',
            id: 'operator',
            label: 'Operador',
            permissions: ['email-manager.mailbox.read', 'email-manager.mailbox.write'],
        }]);
        assert.deepEqual(catalog.get('email-manager', 'operator')?.permissions, [
            'email-manager.mailbox.read', 'email-manager.mailbox.write',
        ]);
        assert.equal(catalog.get('invalid-package', 'broken id'), null);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('validates a declared group only while its package definition exists', () => {
    const catalog = { get: (packageName, definitionId) => packageName === 'email-manager' && definitionId === 'operator'
        ? { packageName, id: definitionId, label: 'Operador', permissions: [] }
        : null };
    assert.deepEqual(validateDeclaredGroupInput({ declaredPackage: 'email-manager', declaredGroup: 'operator' }, catalog), {
        declaredPackage: 'email-manager', declaredGroup: 'operator',
    });
    assert.throws(
        () => validateDeclaredGroupInput({ declaredPackage: 'email-manager', declaredGroup: 'missing' }, catalog),
        /definição de grupo/i,
    );
});

test('merges declared and historically granted permissions into a selectable catalog', () => {
    const catalog = {
        list: () => [{
            packageName: 'email-manager', id: 'operator', label: 'Operador',
            permissions: ['email-manager.mailbox.read', 'email-manager.mailbox.write'],
        }],
    };

    assert.deepEqual(listSelectablePermissions({
        catalog,
        grants: [
            { permission: 'email-manager.mailbox.read' },
            { permission: 'legacy.files.export' },
            { permission: 'legacy.files.export' },
            { permission: '../invalid' },
        ],
    }), [
        { permission: 'email-manager.mailbox.read', packageName: 'email-manager', resource: 'mailbox', action: 'read', sources: ['declared', 'historical'] },
        { permission: 'email-manager.mailbox.write', packageName: 'email-manager', resource: 'mailbox', action: 'write', sources: ['declared'] },
        { permission: 'legacy.files.export', packageName: 'legacy', resource: 'files', action: 'export', sources: ['historical'] },
    ]);
});
