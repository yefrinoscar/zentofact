import test from 'node:test';
import assert from 'node:assert/strict';
import {
  explicitPermissions,
  firstAllowedPath,
  grantsForRole,
  isPermissionsLocked,
  isReadOnlyUser,
  isSalespersonOnly,
  isSalespersonUser,
  parsePermissions,
  pathPermission,
  PERMISSIONS,
  permissionsForUser,
  pickPermissionEditingRole,
  presetPermissionsForRole,
  primaryRoleOf,
  ROLE_PRESETS,
  rolePermissionsPayload,
  SELECTABLE_ROLES,
  toggleRoleAssignment,
  userCanWritePermission,
  userHasPermission,
} from './permissions.ts';

test('envío propio es una opción de Ajustes', () => {
  assert.equal(pathPermission('/envio-propio'), 'settings');
  assert.equal(pathPermission('/orders/envio'), 'settings');
  assert.equal(pathPermission('/settings'), 'settings');
  assert.equal(pathPermission('/orders'), 'order_management');
  assert.equal(pathPermission('/cancelados'), 'order_management');
});

test('insumos pertenece a Pedidos junto a preparación y escaneo', () => {
  const insumos = PERMISSIONS.find(({ key }) => key === 'insumos');
  const scannerIndex = PERMISSIONS.findIndex(({ key }) => key === 'orders_scanner');
  const insumosIndex = PERMISSIONS.findIndex(({ key }) => key === 'insumos');
  assert.equal(insumos?.section, 'orders');
  assert.equal(insumos?.path, '/insumos');
  assert.ok(scannerIndex >= 0 && scannerIndex < insumosIndex);
  assert.equal(pathPermission('/insumos'), 'insumos');
});

test('salesperson aparece antes de todos los pedidos para abrir Mis ventas', () => {
  const salespersonIndex = PERMISSIONS.findIndex(({ key }) => key === 'salesperson');
  const ordersIndex = PERMISSIONS.findIndex(({ key }) => key === 'order_management');
  assert.equal(PERMISSIONS[salespersonIndex].path, '/mis-ventas');
  assert.equal(PERMISSIONS[salespersonIndex].section, 'orders');
  assert.ok(salespersonIndex >= 0 && salespersonIndex < ordersIndex);
  assert.equal(pathPermission('/mis-ventas'), 'salesperson');
  assert.equal(pathPermission('/pagos'), 'pagos');
  assert.equal(pathPermission('/ventas'), 'dashboard');
  assert.equal(pathPermission('/bandeja'), 'orders_inbox');
  assert.equal(pathPermission('/avisos'), null);
  assert.equal(PERMISSIONS.find(({ key }) => key === 'orders_inbox')?.path, '/bandeja');
});

test('el operador ya no tiene el módulo de salidas', () => {
  assert.equal(PERMISSIONS.some(({ key }) => key === 'salidas'), false);
  assert.equal(pathPermission('/salidas'), null);
  assert.deepEqual(ROLE_PRESETS.operator.permissions, ['order_management', 'return_stock_approve', 'orders_inbox', 'orders_scanner', 'insumos']);
  assert.deepEqual(
    parsePermissions(['order_management', 'orders_inbox', 'orders_scanner', 'salidas', 'insumos'], 'operator'),
    ROLE_PRESETS.operator.permissions,
  );
  assert.deepEqual(
    parsePermissions(['order_management', 'orders_inbox', 'orders_scanner', 'insumos'], 'operator'),
    ROLE_PRESETS.operator.permissions,
  );
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

test('el frontend une pertenencias y respeta vacíos explícitos', () => {
  const vendedorOperator = {
    id: 'v', name: 'V', email: 'v@example.com',
    role: 'operator',
    roles: ['operator', 'vendedor'],
    rolePermissions: { operator: ['order_management', 'orders_inbox'], vendedor: ['salesperson'] },
    active: true,
  };
  assert.equal(userHasPermission(vendedorOperator, 'salesperson'), true);
  assert.equal(userHasPermission(vendedorOperator, 'order_management'), true);
  assert.equal(isSalespersonUser(vendedorOperator), true);
  assert.equal(isSalespersonOnly(vendedorOperator), false);
  assert.deepEqual(permissionsForUser(vendedorOperator).sort(), ['order_management', 'orders_inbox', 'salesperson'].sort());

  const sinDefault = {
    id: 'e', name: 'E', email: 'e@example.com',
    role: 'operator',
    roles: ['operator'],
    rolePermissions: { operator: [] },
    active: true,
  };
  assert.deepEqual(explicitPermissions([], 'operator'), []);
  assert.equal(userHasPermission(sinDefault, 'order_management'), false);

  const admin = { id: 'a', name: 'A', email: 'a@example.com', role: 'admin', roles: ['admin'], rolePermissions: { admin: [] }, active: true };
  assert.equal(isSalespersonUser(admin), false);
  assert.equal(userHasPermission(admin, 'boletas'), true);
});

test('el viewer legacy sigue solo lectura aunque se combine con otro perfil', () => {
  const viewer = { id: 'w', name: 'W', email: 'w@example.com', role: 'viewer', roles: ['viewer'], rolePermissions: { viewer: ['boletas'] }, active: true };
  assert.equal(isReadOnlyUser(viewer), true);
  assert.equal(userCanWritePermission(viewer, 'boletas'), false);
  const mixed = {
    id: 'm', name: 'M', email: 'm@example.com', role: 'viewer',
    roles: ['viewer', 'operator'],
    rolePermissions: { viewer: ['boletas'], operator: ['order_management'] },
    active: true,
  };
  assert.equal(isReadOnlyUser(mixed), false);
  assert.equal(userCanWritePermission(mixed, 'boletas'), false);
  assert.equal(userCanWritePermission(mixed, 'order_management'), true);
});

test('primaryRoleOf elige el perfil principal por rango y orden', () => {
  assert.equal(primaryRoleOf(['vendedor', 'operator']), 'operator');
  assert.equal(primaryRoleOf(['billing', 'vendedor']), 'billing');
  assert.equal(primaryRoleOf(['admin', 'superadmin']), 'superadmin');
  assert.equal(primaryRoleOf([]), 'operator');
  assert.equal(primaryRoleOf(undefined), 'operator');
});

// ── Editor multi-perfil: no perder permisos personalizados ───────────────────

test('cambiar el perfil principal no pierde los permisos personalizados', () => {
  // Facturación con un acceso personalizado (solo boletas, sin el preset).
  let state = {
    roles: ['billing'],
    rolePermissions: { billing: ['boletas'] },
    editingRole: 'billing',
  };
  // Al añadir Operador, el principal pasa de billing a operator (empate por orden).
  state = toggleRoleAssignment(state, 'operator');
  assert.deepEqual(state.roles, ['billing', 'operator']);
  assert.equal(primaryRoleOf(state.roles), 'operator');
  // El custom de billing sobrevive; el nuevo perfil estrena su preset.
  assert.deepEqual(state.rolePermissions.billing, ['boletas']);
  assert.deepEqual(state.rolePermissions.operator, [...ROLE_PRESETS.operator.permissions]);

  const payload = rolePermissionsPayload(state.roles, state.rolePermissions);
  assert.deepEqual(payload.billing, ['boletas']);
  assert.deepEqual(payload.operator, [...ROLE_PRESETS.operator.permissions]);
});

test('retirar un perfil lo quita del payload; volver a marcarlo conserva su custom', () => {
  let state = {
    roles: ['operator', 'billing'],
    rolePermissions: { operator: ['order_management'], billing: ['boletas'] },
    editingRole: 'operator',
  };
  // Quitar operator: sigue en el mapa (para no perder el custom) pero no viaja al API.
  state = toggleRoleAssignment(state, 'operator');
  assert.deepEqual(state.roles, ['billing']);
  assert.deepEqual(
    Object.keys(rolePermissionsPayload(state.roles, state.rolePermissions)),
    ['billing'],
  );
  assert.deepEqual(state.rolePermissions.operator, ['order_management']);

  // Volver a marcarlo antes de guardar recupera el custom, no el preset.
  state = toggleRoleAssignment(state, 'operator');
  assert.deepEqual([...state.roles].sort(), ['billing', 'operator']);
  assert.deepEqual(state.rolePermissions.operator, ['order_management']);
  const payload = rolePermissionsPayload(state.roles, state.rolePermissions);
  assert.deepEqual(payload.operator, ['order_management']);
  assert.deepEqual(payload.billing, ['boletas']);
});

test('un perfil nuevo estrena preset y el admin siempre va completo', () => {
  const state = toggleRoleAssignment(
    { roles: ['operator'], rolePermissions: { operator: [] }, editingRole: 'operator' },
    'billing',
  );
  assert.deepEqual(state.rolePermissions.billing, [...ROLE_PRESETS.billing.permissions]);
  const payload = rolePermissionsPayload(['admin', 'operator'], { operator: [] });
  assert.deepEqual(payload.admin, [...PERMISSIONS.map((p) => p.key)]);
});

test('el perfil a personalizar prefiere uno editable sobre el principal bloqueado', () => {
  // admin (bloqueado) + operator (editable): se edita el operador.
  assert.equal(pickPermissionEditingRole(['admin', 'operator'], 'admin'), 'operator');
  // Solo vendedor: no hay perfil editable, se muestra su mensaje fijo.
  assert.equal(pickPermissionEditingRole(['vendedor'], 'vendedor'), 'vendedor');
  assert.equal(isPermissionsLocked('vendedor'), true);
});

test('grantsForRole respeta un vacío explícito y completa los bloqueados', () => {
  assert.deepEqual(grantsForRole({ operator: [] }, 'operator'), []);
  assert.deepEqual(grantsForRole({}, 'operator'), [...ROLE_PRESETS.operator.permissions]);
  assert.deepEqual(grantsForRole({ vendedor: ['boletas'] }, 'vendedor'), ['salesperson']);
  assert.deepEqual(grantsForRole({}, 'admin'), PERMISSIONS.map((p) => p.key));
  assert.deepEqual(presetPermissionsForRole('billing'), [...ROLE_PRESETS.billing.permissions]);
});
