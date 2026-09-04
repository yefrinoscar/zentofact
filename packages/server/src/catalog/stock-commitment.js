// 12:00 America/Lima del 3 set 2026. Pedidos anteriores no reservan ni descuentan.
export const INVENTORY_LISTEN_FROM_AT = '2026-09-03T17:00:00.000Z';

export const STOCK_RESERVE_FULFILLMENT = new Set(['pending', 'preparing']);
export const STOCK_COMMIT_FULFILLMENT = new Set(['ready_to_ship', 'shipped', 'delivered']);
export const STOCK_QUEUE_FULFILLMENT = new Set([
  ...STOCK_RESERVE_FULFILLMENT,
  ...STOCK_COMMIT_FULFILLMENT,
]);

export function stockCommitmentAction(status) {
  const value = String(status || '').trim().toLowerCase();
  if (STOCK_RESERVE_FULFILLMENT.has(value)) return 'reserve';
  if (STOCK_COMMIT_FULFILLMENT.has(value)) return 'commit';
  return 'none';
}

export function isStockReserveFulfillment(status) {
  return stockCommitmentAction(status) === 'reserve';
}

export function isStockCommitFulfillment(status) {
  return stockCommitmentAction(status) === 'commit';
}

export function shouldEnqueueStockJob(status) {
  return STOCK_QUEUE_FULFILLMENT.has(String(status || '').trim().toLowerCase());
}

export function isAfterInventoryListenFrom(value) {
  if (value == null || value === '') return false;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return false;
  return time >= Date.parse(INVENTORY_LISTEN_FROM_AT);
}

export function shouldListenStockOrder(input = {}) {
  return shouldEnqueueStockJob(input.status)
    && isAfterInventoryListenFrom(orderListenAt(input) ?? input.orderedAt ?? input.ordered_at);
}

export function orderListenAt(order) {
  return order?.ordered_at || order?.orderedAt || null;
}
