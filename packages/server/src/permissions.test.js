import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPermissionsLocked,
  normalizePermissions,
  pathPermission,
  PERMISSIONS,
  ROLE_PRESETS,
  SELECTABLE_ROLES,
  userHasPermission,
} from './permissions.js';

test('un viewer no puede administrar usuarios aunque se inyecte el permiso', () => {
  assert.equal(userHasPermission({ role: 'viewer', active: true, permissions: ['users'] }, 'users'), false);
});

test('un superadmin conserva acceso total', () => {
  assert.equal(userHasPermission({ role: 'superadmin', active: true, permissions: [] }, 'users'), true);
  assert.equal(userHasPermission({ role: 'superadmin', active: true, permissions: [] }, 'falabella_sellers'), true);
  assert.deepEqual(normalizePermissions([], 'superadmin').sort(), normalizePermissions([], 'admin').sort());
});

test('un usuario desactivado no obtiene permisos', () => {
  assert.equal(userHasPermission({ role: 'admin', active: false, permissions: [] }, 'users'), false);
});

test('el dashboard queda reservado para administradores', () => {
  assert.equal(userHasPermission({ role: 'viewer', active: true, permissions: ['dashboard'] }, 'dashboard'), false);
  assert.equal(userHasPermission({ role: 'operator', active: true, permissions: ['dashboard'] }, 'dashboard'), false);
  assert.equal(userHasPermission({ role: 'admin', active: true, permissions: [] }, 'dashboard'), true);
  assert.equal(userHasPermission({ role: 'viewer', active: true, permissions: ['dashboard'] }, 'companies'), false);
});

test('el catálogo separa secciones y subsecciones del menú', () => {
  const keys = new Set(PERMISSIONS.map(({ key }) => key));
  assert.equal(keys.has('orders_inbox'), true);
  assert.equal(keys.has('orders_scanner'), true);
  assert.equal(keys.has('boletas'), true);
  assert.equal(keys.has('facturas'), true);
  assert.equal(keys.has('credit_notes_manage'), true);
  assert.equal(keys.has('credit_notes_bulk'), true);
  assert.equal(keys.has('salidas'), true);
  assert.equal(keys.has('insumos'), true);
  assert.equal(PERMISSIONS.find(({ key }) => key === 'salidas')?.section, 'operation');
  assert.equal(PERMISSIONS.find(({ key }) => key === 'insumos')?.section, 'operation');
  assert.notEqual(PERMISSIONS.find(({ key }) => key === 'order_management')?.hiddenInProduction, true);
  assert.equal(PERMISSIONS.find(({ key }) => key === 'productos')?.hiddenInProduction, true);
  assert.equal(PERMISSIONS.find(({ key }) => key === 'order_management')?.section, 'orders');
  assert.equal(PERMISSIONS.find(({ key }) => key === 'orders_inbox')?.section, 'orders');
});

test('pathPermission separa el listado de notas de la anulación masiva', () => {
  assert.equal(pathPermission('/orders'), 'order_management');
  assert.equal(pathPermission('/pedidos'), 'orders_inbox');
  assert.equal(pathPermission('/scanner'), 'orders_scanner');
  assert.equal(pathPermission('/boletas'), 'boletas');
  assert.equal(pathPermission('/boletas/new'), 'boletas');
  assert.equal(pathPermission('/facturas'), 'facturas');
  assert.equal(pathPermission('/credit-notes'), 'credit_notes_manage');
  assert.equal(pathPermission('/credit-notes/15'), 'credit_notes_manage');
  assert.equal(pathPermission('/credit-notes/bulk'), 'credit_notes_bulk');
  assert.equal(pathPermission('/credit-notes/bulk/confirm'), 'credit_notes_bulk');
  assert.equal(pathPermission('/salidas'), 'salidas');
  assert.equal(pathPermission('/insumos'), 'insumos');
  assert.equal(pathPermission('/productos'), 'productos');
});

test('los permisos antiguos se expanden al catálogo nuevo', () => {
  assert.deepEqual(
    normalizePermissions(['falabella'], 'falabella_manager').sort(),
    ['falabella_sellers', 'order_management', 'orders_inbox', 'orders_scanner'].sort(),
  );
  assert.deepEqual(
    normalizePermissions(['documentos', 'credit_notes'], 'billing').sort(),
    ['boletas', 'credit_notes_bulk', 'credit_notes_manage', 'facturas'].sort(),
  );
});

test('los perfiles representan áreas reales de trabajo', () => {
  assert.deepEqual(SELECTABLE_ROLES, ['superadmin', 'admin', 'operator', 'billing', 'vendedor']);
  assert.deepEqual(ROLE_PRESETS.operator.permissions, ['order_management', 'orders_inbox', 'orders_scanner', 'salidas', 'insumos']);
  assert.deepEqual(ROLE_PRESETS.vendedor.permissions, ['salesperson']);
  assert.equal(ROLE_PRESETS.vendedor.label, 'Vendedor');
  assert.deepEqual(ROLE_PRESETS.billing.permissions, [
    'boletas', 'facturas', 'credit_notes_manage', 'auto_emision', 'credit_notes_bulk',
  ]);
  assert.deepEqual(ROLE_PRESETS.falabella_manager.permissions, ['falabella_sellers']);
  assert.deepEqual(ROLE_PRESETS.viewer.permissions, [
    'falabella_sellers', 'orders_inbox', 'boletas', 'facturas', 'credit_notes_manage',
  ]);
  assert.equal(ROLE_PRESETS.operator.permissions.includes('boletas'), false);
});

test('un operador anterior sin insumos recupera el preset actual', () => {
  assert.deepEqual(
    normalizePermissions(['order_management', 'orders_inbox', 'orders_scanner', 'salidas'], 'operator'),
    ROLE_PRESETS.operator.permissions,
  );
});

test('un perfil básico con permisos vacíos recupera su preset', () => {
  assert.deepEqual(normalizePermissions([], 'operator'), ROLE_PRESETS.operator.permissions);
  assert.deepEqual(normalizePermissions('[]', 'billing'), ROLE_PRESETS.billing.permissions);
});

test('la matriz final de perfiles permite y rechaza los módulos correctos', () => {
  const operator = { role: 'operator', active: true, permissions: ROLE_PRESETS.operator.permissions };
  assert.equal(userHasPermission(operator, 'order_management'), true);
  assert.equal(userHasPermission(operator, 'orders_inbox'), true);
  assert.equal(userHasPermission(operator, 'orders_scanner'), true);
  assert.equal(userHasPermission(operator, 'salidas'), true);
  assert.equal(userHasPermission(operator, 'insumos'), true);
  assert.equal(userHasPermission(operator, 'falabella_sellers'), false);
  assert.equal(userHasPermission(operator, 'boletas'), false);
  assert.equal(userHasPermission(operator, 'auto_emision'), false);

  const billing = { role: 'billing', active: true, permissions: ROLE_PRESETS.billing.permissions };
  assert.equal(userHasPermission(billing, 'boletas'), true);
  assert.equal(userHasPermission(billing, 'facturas'), true);
  assert.equal(userHasPermission(billing, 'credit_notes_manage'), true);
  assert.equal(userHasPermission(billing, 'auto_emision'), true);
  assert.equal(userHasPermission(billing, 'credit_notes_bulk'), true);
  assert.equal(userHasPermission(billing, 'orders_inbox'), false);
  assert.equal(userHasPermission(billing, 'falabella_sellers'), false);

  for (const role of ['admin', 'superadmin']) {
    const administrative = { role, active: true, permissions: [] };
    for (const { key } of PERMISSIONS) assert.equal(userHasPermission(administrative, key), true);
  }
});

test('los perfiles son presets y admiten permisos adicionales', () => {
  assert.equal(userHasPermission({ role: 'operator', active: true, permissions: ['boletas'] }, 'boletas'), true);
  assert.equal(userHasPermission({ role: 'billing', active: true, permissions: ['orders_inbox'] }, 'orders_inbox'), true);
  assert.equal(userHasPermission({ role: 'falabella_manager', active: true, permissions: ['companies'] }, 'companies'), true);
  assert.equal(userHasPermission({ role: 'billing', active: true, permissions: ['facturas'] }, 'facturas'), true);
});

test('los presets generales anteriores migran a los nuevos perfiles acotados', () => {
  assert.deepEqual(normalizePermissions([
    'dashboard', 'documentos', 'falabella', 'productos', 'auto_emision',
    'credit_notes', 'companies', 'settings',
  ], 'operator'), ROLE_PRESETS.operator.permissions);
  assert.deepEqual(normalizePermissions([
    'falabella_sellers', 'orders_inbox', 'boletas', 'facturas',
    'credit_notes_manage', 'settings',
  ], 'viewer'), ROLE_PRESETS.viewer.permissions);
  assert.deepEqual(
    normalizePermissions(['falabella_sellers', 'orders_inbox', 'orders_scanner'], 'operator'),
    ROLE_PRESETS.operator.permissions,
  );
  assert.deepEqual(
    normalizePermissions(['orders_inbox', 'orders_scanner'], 'operator'),
    ROLE_PRESETS.operator.permissions,
  );
  assert.deepEqual(
    normalizePermissions(['order_management', 'orders_inbox', 'orders_scanner'], 'operator'),
    ROLE_PRESETS.operator.permissions,
  );
  assert.deepEqual(
    normalizePermissions(['boletas', 'facturas', 'credit_notes_manage'], 'billing'),
    ROLE_PRESETS.billing.permissions,
  );
});

test('el vendedor conserva el preset fijo y no admite permisos extra', () => {
  const salespersonIndex = PERMISSIONS.findIndex(({ key }) => key === 'salesperson');
  const ordersIndex = PERMISSIONS.findIndex(({ key }) => key === 'order_management');
  assert.equal(PERMISSIONS[salespersonIndex].path, '/mis-ventas');
  assert.equal(PERMISSIONS[salespersonIndex].section, 'orders');
  assert.ok(salespersonIndex >= 0 && salespersonIndex < ordersIndex);
  assert.equal(pathPermission('/mis-ventas'), 'salesperson');
  assert.equal(isPermissionsLocked('vendedor'), true);
  assert.equal(isPermissionsLocked('admin'), true);
  assert.equal(isPermissionsLocked('operator'), false);
  assert.deepEqual(normalizePermissions(['order_management', 'boletas'], 'vendedor'), ['salesperson']);
  assert.deepEqual(normalizePermissions([], 'vendedor'), ['salesperson']);
  assert.deepEqual(normalizePermissions('[]', 'vendedor'), ['salesperson']);
  const vendedor = { role: 'vendedor', active: true, permissions: ['order_management', 'users'] };
  assert.equal(userHasPermission(vendedor, 'salesperson'), true);
  assert.equal(userHasPermission(vendedor, 'order_management'), false);
  assert.equal(userHasPermission(vendedor, 'dashboard'), false);
  assert.equal(userHasPermission({ role: 'operator', active: true, permissions: ['salesperson'] }, 'salesperson'), false);
});
