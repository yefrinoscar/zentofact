import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INVENTORY_LISTEN_RESET_KEY,
  resetInventoryListenHistory,
} from './stock-listen-reset.js';

function script(sql) {
  return String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
}

test('el reset es idempotente cuando el marcador ya está', async () => {
  const calls = [];
  const result = await resetInventoryListenHistory({
    async query(sql, params = []) {
      calls.push(script(sql));
      if (script(sql).includes('select value from system_settings')) {
        assert.equal(params[0], INVENTORY_LISTEN_RESET_KEY);
        return { rows: [{ value: { done: true } }] };
      }
      return { rows: [] };
    },
  });
  assert.deepEqual(result, { skipped: true, reason: 'already_applied' });
  assert.equal(calls.some((sql) => sql.startsWith('delete from inventory_stock_jobs')), false);
});

test('el reset no toca nada si aún no existe el ledger', async () => {
  const calls = [];
  const result = await resetInventoryListenHistory({
    async query(sql) {
      calls.push(script(sql));
      if (script(sql).includes('select value from system_settings')) return { rows: [] };
      if (script(sql).includes('to_regclass')) return { rows: [{ name: null }] };
      return { rows: [] };
    },
  });
  assert.deepEqual(result, { skipped: true, reason: 'no_movements_table' });
  assert.equal(calls.some((sql) => sql.startsWith('delete from inventory_stock_jobs')), false);
});

test('el reset restaura ventas reservadas, suelta reservas y borra la cola', async () => {
  const calls = [];
  const result = await resetInventoryListenHistory({
    async query(sql) {
      const compact = script(sql);
      calls.push(compact);
      if (compact.includes('select value from system_settings')) return { rows: [] };
      if (compact.includes('to_regclass')) return { rows: [{ name: 'inventory_movements' }] };
      if (compact.includes('select id, product_id, quantity_delta, order_item_id')) {
        return { rows: [{ id: 1, product_id: 9, quantity_delta: -1, order_item_id: 4 }] };
      }
      if (compact.startsWith('update product_inventory inventory')) return { rows: [{ product_id: 9 }] };
      if (compact.startsWith('update order_items')) return { rows: [{ id: 4 }, { id: 5 }] };
      if (compact.startsWith('delete from inventory_movements')) return { rows: [{ id: 1 }] };
      if (compact.startsWith('update product_inventory')) return { rows: [{ product_id: 1 }, { product_id: 2 }, { product_id: 3 }] };
      if (compact.startsWith('delete from inventory_stock_jobs')) return { rows: Array.from({ length: 7 }, (_, id) => ({ id })) };
      return { rows: [] };
    },
  });
  assert.equal(result.skipped, false);
  assert.equal(result.listenSales, 1);
  assert.equal(result.productsRestored, 1);
  assert.equal(result.itemsReset, 2);
  assert.equal(result.movementsDeleted, 1);
  assert.equal(result.reservedCleared, 3);
  assert.equal(result.jobsDeleted, 7);
  assert.equal(calls.some((sql) => sql.includes('quantity_reserved=0')), true);
  assert.equal(calls.some((sql) => sql.startsWith('delete from inventory_stock_jobs')), true);
});
