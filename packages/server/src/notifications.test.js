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
    soldOutProducts: [chair],
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
