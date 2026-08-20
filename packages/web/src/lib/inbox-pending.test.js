import test from 'node:test';
import assert from 'node:assert/strict';
import {
  displayedPendingOrders,
  inboxVisibleCountLabel,
  pendingBoardEmptyCopy,
  resolvePendingDeadlineTab,
} from './inbox-pending.ts';

test('defaults to all pending when none vence hoy (ZEN-18)', () => {
  const pendingOrders = [{ id: 'tomorrow' }, { id: 'later' }];
  const result = displayedPendingOrders({
    selectedTab: null,
    pendingOrders,
    groups: { today: [], tomorrow: [pendingOrders[0]], later: [pendingOrders[1]] },
  });

  assert.equal(result.tab, 'all');
  assert.deepEqual(result.orders, pendingOrders);
  assert.equal(inboxVisibleCountLabel('pending', result.orders.length), '2 pedidos');
});

test('keeps Vencen hoy when that tab has pending orders', () => {
  const today = [{ id: 'today' }];
  assert.deepEqual(displayedPendingOrders({
    selectedTab: null,
    pendingOrders: [...today, { id: 'later' }],
    groups: { today, later: [{ id: 'later' }] },
  }), { tab: 'today', orders: today });
});

test('an explicit empty date tab stays empty so the copy can explain it', () => {
  const pendingOrders = [{ id: 'later' }];
  const result = displayedPendingOrders({
    selectedTab: 'today',
    pendingOrders,
    groups: { today: [], later: pendingOrders },
  });

  assert.equal(result.tab, 'today');
  assert.deepEqual(result.orders, []);
  assert.equal(
    pendingBoardEmptyCopy({
      visibleCount: result.orders.length,
      pendingCount: pendingOrders.length,
      selectedTab: result.tab,
    }),
    'Ningún pendiente vence hoy. Hay 1 en otras fechas.',
  );
});

test('pending copy uses pedidos and ready copy uses etiquetas', () => {
  assert.equal(inboxVisibleCountLabel('pending', 0), '0 pedidos');
  assert.equal(inboxVisibleCountLabel('pending', 1), '1 pedido');
  assert.equal(inboxVisibleCountLabel('ready', 0), '0 etiquetas');
  assert.equal(inboxVisibleCountLabel('ready', 1), '1 etiqueta');
  assert.equal(inboxVisibleCountLabel('shipped', 2), '2 etiquetas');
});

test('auto tab prefers today and otherwise all', () => {
  assert.equal(resolvePendingDeadlineTab({ selectedTab: null, todayCount: 0, pendingCount: 2 }), 'all');
  assert.equal(resolvePendingDeadlineTab({ selectedTab: null, todayCount: 1, pendingCount: 2 }), 'today');
  assert.equal(resolvePendingDeadlineTab({ selectedTab: '2026-08-21', todayCount: 0, pendingCount: 2 }), '2026-08-21');
});
