import test from 'node:test';
import assert from 'node:assert/strict';
import {
  explicitPermissions,
  isAdminUser,
  isPermissionsLocked,
  isReadOnlyUser,
  isSalespersonOnly,
  isSalespersonUser,
  normalizePermissions,
  pathPermission,
  PERMISSIONS,
  permissionsForUser,
  primaryRoleOf,
  ROLE_PRESETS,
  SELECTABLE_ROLES,
  userCanWritePermission,
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

test('el dashboard y pagos quedan reservados para administradores', () => {
  assert.equal(userHasPermission({ role: 'viewer', active: true, permissions: ['dashboard'] }, 'dashboard'), false);
  assert.equal(userHasPermission({ role: 'operator', active: true, permissions: ['dashboard'] }, 'dashboard'), false);
  assert.equal(userHasPermission({ role: 'admin', active: true, permissions: [] }, 'dashboard'), true);
  assert.equal(userHasPermission({ role: 'operator', active: true, permissions: ['pagos'] }, 'pagos'), false);
  assert.equal(userHasPermission({ role: 'admin', active: true, permissions: [] }, 'pagos'), true);
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
  assert.equal(keys.has('insumos'), true);
  assert.equal(keys.has('pagos'), true);
  assert.equal(PERMISSIONS.find(({ key }) => key === 'insumos')?.section, 'orders');
  assert.notEqual(PERMISSIONS.find(({ key }) => key === 'order_management')?.hiddenInProduction, true);
  assert.equal(PERMISSIONS.find(({ key }) => key === 'productos')?.hiddenInProduction, true);
  assert.equal(PERMISSIONS.find(({ key }) => key === 'order_management')?.section, 'orders');
  assert.equal(PERMISSIONS.find(({ key }) => key === 'orders_inbox')?.section, 'orders');
});

test('pathPermission separa el listado de notas de la anulación masiva', () => {
  assert.equal(pathPermission('/orders'), 'order_management');
  assert.equal(pathPermission('/cancelados'), 'order_management');
  assert.equal(pathPermission('/bandeja'), 'orders_inbox');
  assert.equal(pathPermission('/pedidos'), 'orders_inbox');
  assert.equal(pathPermission('/bandeja'), 'orders_inbox');
  assert.equal(pathPermission('/scanner'), 'orders_scanner');
  assert.equal(pathPermission('/boletas'), 'boletas');
  assert.equal(pathPermission('/boletas/new'), 'boletas');
  assert.equal(pathPermission('/facturas'), 'facturas');
  assert.equal(pathPermission('/credit-notes'), 'credit_notes_manage');
  assert.equal(pathPermission('/credit-notes/15'), 'credit_notes_manage');
  assert.equal(pathPermission('/credit-notes/bulk'), 'credit_notes_bulk');
  assert.equal(pathPermission('/credit-notes/bulk/confirm'), 'credit_notes_bulk');
  assert.equal(pathPermission('/insumos'), 'insumos');
  assert.equal(pathPermission('/avisos'), null);
  assert.equal(pathPermission('/pagos'), 'pagos');
  assert.equal(pathPermission('/ventas'), 'dashboard');
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
  assert.deepEqual(ROLE_PRESETS.operator.permissions, ['order_management', 'return_stock_approve', 'orders_inbox', 'orders_scanner', 'insumos']);
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

test('un operador anterior con salidas pierde ese módulo y conserva el preset actual', () => {
  assert.equal(PERMISSIONS.some(({ key }) => key === 'salidas'), false);
  assert.deepEqual(
    normalizePermissions(['order_management', 'orders_inbox', 'orders_scanner', 'salidas', 'insumos'], 'operator'),
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
  assert.equal(userHasPermission(operator, 'return_stock_approve'), true);
  assert.equal(userHasPermission(operator, 'orders_inbox'), true);
  assert.equal(userHasPermission(operator, 'orders_scanner'), true);
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
  assert.equal(userHasPermission(billing, 'return_stock_approve'), false);

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
    normalizePermissions(['order_management', 'orders_inbox', 'orders_scanner', 'insumos'], 'operator'),
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

// ── Multi-perfil ─────────────────────────────────────────────────────────────

test('pertenencias múltiples unen permisos de cada perfil', () => {
  const vendedorOperator = {
    role: 'operator',
    active: true,
    roles: ['operator', 'vendedor'],
    rolePermissions: { operator: ['order_management', 'orders_inbox', 'orders_scanner', 'insumos'], vendedor: ['salesperson'] },
  };
  assert.equal(userHasPermission(vendedorOperator, 'salesperson'), true);
  assert.equal(userHasPermission(vendedorOperator, 'order_management'), true);
  assert.equal(userHasPermission(vendedorOperator, 'boletas'), false);
  assert.equal(isSalespersonUser(vendedorOperator), true);
  assert.equal(isSalespersonOnly(vendedorOperator), false); // tiene order_management
  assert.deepEqual(permissionsForUser(vendedorOperator).sort(), [
    'insumos', 'order_management', 'orders_inbox', 'orders_scanner', 'salesperson',
  ].sort());
});

test('el vendedor se detecta por pertenencia, no por el permiso que da admin', () => {
  const admin = { role: 'admin', active: true, roles: ['admin'], rolePermissions: { admin: [] } };
  assert.equal(userHasPermission(admin, 'salesperson'), true);
  assert.equal(isSalespersonUser(admin), false);
  assert.equal(isSalespersonOnly(admin), false);
  const soloVendedor = { role: 'vendedor', active: true, roles: ['vendedor'], rolePermissions: { vendedor: ['salesperson'] } };
  assert.equal(isSalespersonUser(soloVendedor), true);
  assert.equal(isSalespersonOnly(soloVendedor), true);
});

test('un perfil que no es primario contribuye su preset a la unión', () => {
  // Primario operator con permisos personalizados; se añade billing (preset).
  const user = {
    role: 'operator',
    active: true,
    roles: ['operator', 'billing'],
    rolePermissions: {
      operator: ['order_management', 'orders_inbox', 'boletas'],
      billing: ['boletas', 'facturas', 'credit_notes_manage', 'auto_emision', 'credit_notes_bulk'],
    },
  };
  assert.equal(userHasPermission(user, 'order_management'), true);
  assert.equal(userHasPermission(user, 'boletas'), true);
  assert.equal(userHasPermission(user, 'facturas'), true);
  assert.equal(userHasPermission(user, 'auto_emision'), true);
  assert.equal(userHasPermission(user, 'orders_scanner'), false); // no está en operator ni billing
  assert.equal(primaryRoleOf(['vendedor', 'operator']), 'operator');
  assert.equal(primaryRoleOf(['admin', 'superadmin']), 'superadmin');
});

test('admin o superadmin conserva acceso total aunque no tenga grants explícitos', () => {
  for (const role of ['admin', 'superadmin']) {
    const user = { role, active: true, roles: [role], rolePermissions: { [role]: [] } };
    for (const { key } of PERMISSIONS) assert.equal(userHasPermission(user, key), true);
    assert.equal(userCanWritePermission(user, 'boletas'), true);
  }
});

test('vacío explícito no restaura defaults del preset', () => {
  assert.deepEqual(explicitPermissions([], 'operator'), []);
  assert.deepEqual(explicitPermissions('[]', 'billing'), []);
  const user = {
    role: 'operator',
    active: true,
    roles: ['operator', 'vendedor'],
    rolePermissions: { operator: [], vendedor: ['salesperson'] },
  };
  assert.equal(userHasPermission(user, 'order_management'), false);
  assert.equal(userHasPermission(user, 'salesperson'), true);
});

test('la lista personalizada del perfil original se conserva al unir perfiles', () => {
  // Operador con boletas extra (custom) + perfil vendedor: conserva boletas.
  const user = {
    role: 'operator',
    active: true,
    roles: ['operator', 'vendedor'],
    rolePermissions: { operator: ['order_management', 'boletas'], vendedor: ['salesperson'] },
  };
  assert.equal(userHasPermission(user, 'boletas'), true);
  assert.equal(userHasPermission(user, 'order_management'), true);
  assert.equal(userHasPermission(user, 'salesperson'), true);
});

test('un viewer legacy sigue solo lectura y no se mezcla con escritura ajena', () => {
  const viewer = { role: 'viewer', active: true, roles: ['viewer'], rolePermissions: { viewer: ['falabella_sellers', 'boletas'] } };
  assert.equal(isReadOnlyUser(viewer), true);
  assert.equal(userHasPermission(viewer, 'boletas'), true);
  assert.equal(userCanWritePermission(viewer, 'boletas'), false);

  // viewer + operator: operator sí escribe lo que concede; los grants viewer no.
  const mixed = {
    role: 'viewer',
    active: true,
    roles: ['viewer', 'operator'],
    rolePermissions: {
      viewer: ['falabella_sellers', 'boletas'],
      operator: ['order_management', 'orders_inbox'],
    },
  };
  assert.equal(isReadOnlyUser(mixed), false);
  assert.equal(userHasPermission(mixed, 'boletas'), true);
  assert.equal(userCanWritePermission(mixed, 'boletas'), false);
  assert.equal(userCanWritePermission(mixed, 'order_management'), true);
});

test('viewer + vendedor no habilita escritura de facturación', () => {
  // El viewer aporta lectura de comprobantes; el vendedor solo salesperson.
  // Ninguno de los dos concede escritura de boletas/facturas/notas de crédito.
  const user = {
    role: 'viewer',
    active: true,
    roles: ['viewer', 'vendedor'],
    rolePermissions: {
      viewer: ['falabella_sellers', 'boletas', 'facturas', 'credit_notes_manage'],
      vendedor: ['salesperson'],
    },
  };
  // Lectura: la unión sí ve los módulos del viewer.
  assert.equal(userHasPermission(user, 'boletas'), true);
  assert.equal(userHasPermission(user, 'facturas'), true);
  assert.equal(userHasPermission(user, 'credit_notes_manage'), true);
  assert.equal(userHasPermission(user, 'salesperson'), true);
  // Escritura de facturación: bloqueada (viewer es solo lectura).
  assert.equal(userCanWritePermission(user, 'boletas'), false);
  assert.equal(userCanWritePermission(user, 'facturas'), false);
  assert.equal(userCanWritePermission(user, 'credit_notes_manage'), false);
  // El vendedor sí puede escribir solo lo suyo.
  assert.equal(userCanWritePermission(user, 'salesperson'), true);
  assert.equal(isReadOnlyUser(user), false);
  // RegistrarVenta: es "solo vendedor" porque no gestiona pedidos.
  assert.equal(isSalespersonOnly(user), true);
});

test('admin multi-perfil no convierte en vendedor ni pierde acceso', () => {
  const user = {
    role: 'admin',
    active: true,
    roles: ['admin', 'vendedor'],
    rolePermissions: { admin: [], vendedor: ['salesperson'] },
  };
  assert.equal(isAdminUser(user), true);
  assert.equal(isSalespersonUser(user), true);
  assert.equal(userHasPermission(user, 'users'), true);
  assert.equal(userHasPermission(user, 'dashboard'), true);
  assert.equal(userCanWritePermission(user, 'facturas'), true);
  assert.equal(isSalespersonOnly(user), false);
});
