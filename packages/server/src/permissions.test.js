import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePermissions, userHasPermission } from './permissions.js';

test('un viewer no puede administrar usuarios aunque se inyecte el permiso', () => {
  assert.equal(userHasPermission({ role: 'viewer', active: true, permissions: ['users'] }, 'users'), false);
});

test('un superadmin conserva acceso total', () => {
  assert.equal(userHasPermission({ role: 'superadmin', active: true, permissions: [] }, 'users'), true);
  assert.equal(userHasPermission({ role: 'superadmin', active: true, permissions: [] }, 'falabella'), true);
  assert.deepEqual(normalizePermissions([], 'superadmin').sort(), normalizePermissions([], 'admin').sort());
});

test('un usuario desactivado no obtiene permisos', () => {
  assert.equal(userHasPermission({ role: 'admin', active: false, permissions: [] }, 'users'), false);
});
