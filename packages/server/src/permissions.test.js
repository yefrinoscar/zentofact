import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePermissions, pathPermission, PERMISSIONS, userHasPermission } from './permissions.js';

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

test('el rol de consulta puede ver el dashboard sin permisos administrativos', () => {
  assert.equal(userHasPermission({ role: 'viewer', active: true, permissions: ['dashboard'] }, 'dashboard'), true);
  assert.equal(userHasPermission({ role: 'viewer', active: true, permissions: ['dashboard'] }, 'companies'), false);
});

test('el catálogo publica los accesos de comprobantes y anulación masiva', () => {
  const documentos = PERMISSIONS.find(({ key }) => key === 'documentos');
  const creditNotes = PERMISSIONS.find(({ key }) => key === 'credit_notes');

  assert.deepEqual(documentos, {
    key: 'documentos',
    label: 'Comprobantes',
    description: 'Ver y emitir boletas/facturas; ver notas de crédito',
    path: '/boletas',
  });
  assert.deepEqual(creditNotes, {
    key: 'credit_notes',
    label: 'Anulación masiva',
    description: 'Anular boletas en lote con notas de crédito',
    path: '/credit-notes/bulk',
  });
});

test('pathPermission separa el listado de notas de la anulación masiva', () => {
  assert.equal(pathPermission('/boletas'), 'documentos');
  assert.equal(pathPermission('/boletas/new'), 'documentos');
  assert.equal(pathPermission('/facturas'), 'documentos');
  assert.equal(pathPermission('/credit-notes'), 'documentos');
  assert.equal(pathPermission('/credit-notes/15'), 'documentos');
  assert.equal(pathPermission('/credit-notes/bulk'), 'credit_notes');
  assert.equal(pathPermission('/credit-notes/bulk/confirm'), 'credit_notes');
});
