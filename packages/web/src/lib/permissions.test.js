import test from 'node:test';
import assert from 'node:assert/strict';
import {
  firstAllowedPath,
  isPermissionsLocked,
  parsePermissions,
  pathPermission,
  PERMISSIONS,
  ROLE_PRESETS,
  SELECTABLE_ROLES,
  userHasPermission,
} from './permissions.ts';

test('salesperson aparece antes de todos los pedidos para abrir Mis ventas', () => {
  const salespersonIndex = PERMISSIONS.findIndex(({ key }) => key === 'salesperson');
  const ordersIndex = PERMISSIONS.findIndex(({ key }) => key === 'order_management');
  assert.equal(PERMISSIONS[salespersonIndex].path, '/mis-ventas');
  assert.equal(PERMISSIONS[salespersonIndex].section, 'orders');
  assert.ok(salespersonIndex >= 0 && salespersonIndex < ordersIndex);
  assert.equal(pathPermission('/mis-ventas'), 'salesperson');
  assert.equal(pathPermission('/pagos'), 'pagos');
  assert.equal(pathPermission('/bandeja'), 'orders_inbox');
  assert.equal(PERMISSIONS.find(({ key }) => key === 'orders_inbox')?.path, '/bandeja');
});

test('el vendedor tiene preset fijo y permisos bloqueados', () => {
  assert.ok(SELECTABLE_ROLES.includes('vendedor'));
  assert.deepEqual(ROLE_PRESETS.vendedor.permissions, ['salesperson']);
  assert.equal(isPermissionsLocked('vendedor'), true);
  assert.equal(isPermissionsLocked('admin'), true);
  assert.equal(isPermissionsLocked('operator'), false);
  assert.deepEqual(parsePermissions(['order_management', 'boletas'], 'vendedor'), ['salesperson']);
  assert.deepEqual(parsePermissions([], 'vendedor'), ['salesperson']);
  const vendedor = { id: 'u1', name: 'Ana', email: 'ana@example.com', role: 'vendedor', permissions: ['users'] };
  assert.equal(userHasPermission(vendedor, 'salesperson'), true);
  assert.equal(userHasPermission(vendedor, 'order_management'), false);
  assert.equal(firstAllowedPath(vendedor, false), '/mis-ventas');
  assert.equal(userHasPermission({
    id: 'op', name: 'Op', email: 'op@example.com', role: 'operator', permissions: ['salesperson'],
  }, 'salesperson'), false);
});
