import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyNotificationState,
  buildBandejaOverdueNotification,
  buildEmissionFailedNotification,
  buildInsumoLowStockNotification,
  buildProductSoldOutNotification,
  collectLiveNotifications,
  filterNotificationsForUser,
  isProductSoldOut,
  notificationPermissionForKind,
  parseNotificationIds,
  publicNotification,
  sortNotifications,
  unreadNotificationCount,
} from './notifications-policy.js';
import { ROLE_PRESETS, userHasPermission } from './permissions.js';

const fill = {
  id: 4,
  name: 'Fill grande',
  unit: 'rollos',
  quantityOnHand: 2,
  reorderPoint: 2,
  status: 'active',
  updatedAt: '2026-09-08T15:00:00.000Z',
};
const operator = {
  role: 'operator',
  active: true,
  permissions: ROLE_PRESETS.operator.permissions,
};
const billing = {
  role: 'billing',
  active: true,
  permissions: ROLE_PRESETS.billing.permissions,
};
const vendedor = {
  role: 'vendedor',
  active: true,
  permissions: ROLE_PRESETS.vendedor.permissions,
};

test('un comprobante fallido se resume en un solo aviso crítico', () => {
  const one = buildEmissionFailedNotification({ count: 1, updatedAt: '2026-09-10T12:00:00.000Z' });
  assert.equal(one.kind, 'emission_failed');
  assert.equal(one.severity, 'critical');
  assert.equal(one.title, 'Un comprobante no se emitió');
  assert.equal(one.href, '/auto-emision');
  assert.equal(one.id, 'emission_failed:1');
  assert.equal(buildEmissionFailedNotification({ count: 0 }), null);
  assert.equal(buildEmissionFailedNotification({ count: 4 }).title, '4 comprobantes no se emitieron');
});

test('un insumo avisa al llegar al mínimo y cambia de id si el saldo sigue bajando', () => {
  const low = buildInsumoLowStockNotification(fill);
  assert.equal(low.severity, 'warning');
  assert.equal(low.title, 'Fill grande está por reponer');
  assert.equal(low.id, 'insumo_low_stock:4:2');
  assert.match(low.body, /Saldo 2 rollos/);
  const empty = buildInsumoLowStockNotification({ ...fill, quantityOnHand: 0 });
  assert.equal(empty.severity, 'critical');
  assert.equal(empty.id, 'insumo_low_stock:4:0');
  assert.equal(buildInsumoLowStockNotification({ ...fill, quantityOnHand: 8 }), null);
  assert.equal(buildInsumoLowStockNotification({ ...fill, id: null }), null);
});

const chair = {
  id: 22,
  mainSku: 'HOG025',
  name: 'Silla evolutiva',
  status: 'active',
  quantityOnHand: 0,
  quantityReserved: 0,
  quantityPendingReturn: 0,
  unitsSold7d: 18,
  lastSoldAt: '2026-09-10T15:00:00.000Z',
};

test('un producto agotado avisa con su rotación de 7 días', () => {
  assert.equal(isProductSoldOut({ ...chair, unitsSold7d: 0 }), false);
  assert.equal(isProductSoldOut({ ...chair, quantityOnHand: 4 }), false);
  const hot = buildProductSoldOutNotification(chair);
  assert.equal(hot.kind, 'product_sold_out');
  assert.equal(hot.severity, 'critical');
  assert.equal(hot.title, 'Silla evolutiva se agotó');
  assert.equal(hot.body, 'HOG025 · Se está vendiendo mucho: 18 unidades en 7 días.');
  assert.equal(hot.href, '/productos');
  assert.equal(hot.id, 'product_sold_out:22:18');
  const slow = buildProductSoldOutNotification({ ...chair, unitsSold7d: 2 });
  assert.equal(slow.severity, 'warning');
  assert.equal(slow.body, 'HOG025 · Vendió 2 unidades en 7 días.');
  assert.equal(buildProductSoldOutNotification({ ...chair, id: null }), null);
});

test('los vencidos de bandeja se agrupan y no se inventan sin pedidos', () => {
  assert.equal(buildBandejaOverdueNotification({ count: 0 }), null);
  const one = buildBandejaOverdueNotification({ count: 1, oldestAt: '2026-09-01T15:00:00.000Z' });
  assert.equal(one.title, 'Hay 1 pedido vencido');
  assert.equal(one.href, '/bandeja');
  assert.equal(buildBandejaOverdueNotification({ count: 12 }).id, 'bandeja_overdue:12');
});

test('cada aviso exige el permiso del módulo que lo resuelve', () => {
  assert.equal(notificationPermissionForKind('emission_failed'), 'auto_emision');
  assert.equal(notificationPermissionForKind('insumo_low_stock'), 'insumos');
  assert.equal(notificationPermissionForKind('bandeja_overdue'), 'orders_inbox');
  assert.deepEqual(notificationPermissionForKind('product_sold_out'), ['productos', 'order_management']);
  const live = collectLiveNotifications({
    failedEmissions: { count: 2, updatedAt: '2026-09-10T12:00:00.000Z' },
    lowInsumos: [fill],
    overdueBandeja: { count: 3, oldestAt: '2026-09-01T15:00:00.000Z' },
    stockProducts: [chair],
  });
  assert.equal(live.length, 4);
  assert.deepEqual(
    filterNotificationsForUser(live, operator, userHasPermission).map((item) => item.kind).sort(),
    ['bandeja_overdue', 'insumo_low_stock', 'product_sold_out'],
  );
  assert.deepEqual(
    filterNotificationsForUser(live, billing, userHasPermission).map((item) => item.kind),
    ['emission_failed'],
  );
  assert.deepEqual(filterNotificationsForUser(live, vendedor, userHasPermission), []);
});

test('un aviso leído o descartado no cuenta como pendiente', () => {
  const live = collectLiveNotifications({
    failedEmissions: { count: 1, updatedAt: '2026-09-10T12:00:00.000Z' },
    lowInsumos: [fill],
  });
  const visible = applyNotificationState(live, new Map([
    ['emission_failed:1', { readAt: '2026-09-10T13:00:00.000Z' }],
    ['insumo_low_stock:4:2', { dismissedAt: '2026-09-10T13:00:00.000Z' }],
  ]));
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, 'emission_failed:1');
  assert.equal(visible[0].unread, false);
  assert.equal(unreadNotificationCount(visible), 0);
});

test('si el saldo del insumo cambia, el aviso descartado vuelve a aparecer', () => {
  const previous = buildInsumoLowStockNotification(fill);
  const next = buildInsumoLowStockNotification({ ...fill, quantityOnHand: 1 });
  const visible = applyNotificationState([next], new Map([
    [previous.id, { dismissedAt: '2026-09-10T13:00:00.000Z' }],
  ]));
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, 'insumo_low_stock:4:1');
  assert.equal(visible[0].unread, true);
});

test('los no leídos críticos van primero', () => {
  const sorted = sortNotifications([
    { id: 'w', severity: 'warning', unread: true, createdAt: '2026-09-10T14:00:00.000Z' },
    { id: 'old-critical', severity: 'critical', unread: false, createdAt: '2026-09-10T16:00:00.000Z' },
    { id: 'c', severity: 'critical', unread: true, createdAt: '2026-09-10T12:00:00.000Z' },
  ]);
  assert.deepEqual(sorted.map((item) => item.id), ['c', 'w', 'old-critical']);
});

test('el DTO público no expone el permiso interno', () => {
  const item = buildEmissionFailedNotification({ count: 1, updatedAt: '2026-09-10T12:00:00.000Z' });
  const published = publicNotification({ ...item, unread: true });
  assert.equal(published.unread, true);
  assert.equal(published.permission, undefined);
  assert.equal(published.kind, 'emission_failed');
});

test('parsea ids de aviso y descarta vacíos o largos', () => {
  assert.deepEqual(parseNotificationIds([' emission_failed:1 ', '', 'emission_failed:1']), ['emission_failed:1']);
  assert.deepEqual(parseNotificationIds('bandeja_overdue:3'), ['bandeja_overdue:3']);
  assert.deepEqual(parseNotificationIds(['x'.repeat(161)]), []);
});

test('G-8 avisa antes de agotarse con una unidad y ventas recientes', () => {
  const items = collectLiveNotifications({
    stockProducts: [{ ...chair, mainSku: 'G-8', name: 'Zapatera', quantityOnHand: 1, unitsSold7d: 2, unitsSold30d: 9 }],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'product_low_stock');
  assert.match(items[0].body, /G-8 · Disponible 1 unidad · cobertura estimada: 4 días/);
});

const shoeRack = { ...chair, mainSku: 'G-8', quantityOnHand: 1, unitsSold7d: 0, unitsSold30d: 9 };
const stockNotice = (product) => collectLiveNotifications({ stockProducts: [product] })[0];

test('la venta lenta sigue avisando aunque no haya ventas en la última semana', () => {
  assert.equal(stockNotice(shoeRack).kind, 'product_low_stock');
  const empty = stockNotice({ ...shoeRack, quantityOnHand: 0 });
  assert.equal(empty.kind, 'product_sold_out');
  assert.match(empty.body, /9 unidades en 30 días/);
});

test('el aviso usa disponible, descontando reservas y devoluciones pendientes', () => {
  const item = stockNotice({ ...shoeRack, quantityOnHand: 5, quantityReserved: 3, quantityPendingReturn: 1 });
  assert.match(item.body, /Disponible 1 unidad/);
});

test('avisa hasta siete días de cobertura y sube a crítico hasta tres', () => {
  const product = { ...shoeRack, unitsSold7d: 7, unitsSold30d: 30 };
  assert.equal(stockNotice({ ...product, quantityOnHand: 7 }).severity, 'warning');
  assert.equal(stockNotice({ ...product, quantityOnHand: 8 }), undefined);
  assert.equal(stockNotice({ ...product, quantityOnHand: 3 }).severity, 'critical');
  assert.equal(stockNotice({ ...product, quantityOnHand: 4 }).severity, 'warning');
  assert.equal(stockNotice({ ...product, status: 'archived' }), undefined);
  assert.equal(stockNotice({ ...product, unitsSold7d: 0, unitsSold30d: 0 }), undefined);
});

test('descartar no oculta un descenso de stock ni un aumento de urgencia', () => {
  const product = { ...shoeRack, quantityOnHand: 2, unitsSold7d: 0 };
  const initial = stockNotice(product);
  const state = new Map([[initial.id, { dismissedAt: '2026-09-14T12:00:00Z' }]]);
  assert.equal(applyNotificationState([stockNotice(product)], state).length, 0);
  assert.equal(applyNotificationState([stockNotice({ ...product, quantityOnHand: 1 })], state).length, 1);
  assert.equal(applyNotificationState([stockNotice({ ...product, unitsSold7d: 7 })], state).length, 1);
});

test('los avisos de reposición respetan los permisos de productos', () => {
  const items = [stockNotice(shoeRack)];
  assert.equal(filterNotificationsForUser(items, operator, userHasPermission).length, 1);
  assert.equal(filterNotificationsForUser(items, billing, userHasPermission).length, 0);
  assert.equal(filterNotificationsForUser(items, vendedor, userHasPermission).length, 0);
});
