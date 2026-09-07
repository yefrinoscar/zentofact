import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_ORDER_SYNC_SETTINGS,
  ORDER_SYNC_SETTINGS_KEY,
  loadOrderSyncSettings,
  parseOrderSyncSettings,
  saveOrderSyncSettings,
} from './order-sync-settings.js';

test('parseOrderSyncSettings usa 15 minutos y 5 días si el valor viene vacío', () => {
  assert.deepEqual(parseOrderSyncSettings(null), DEFAULT_ORDER_SYNC_SETTINGS);
  assert.deepEqual(parseOrderSyncSettings({}), DEFAULT_ORDER_SYNC_SETTINGS);
});

test('parseOrderSyncSettings recorta intervalo y ventana a los límites operativos', () => {
  assert.deepEqual(parseOrderSyncSettings({ intervalMinutes: 0, lookbackDays: 0 }), {
    intervalMinutes: 1,
    lookbackDays: 1,
  });
  assert.deepEqual(parseOrderSyncSettings({ intervalMinutes: 10_000, lookbackDays: 90 }), {
    intervalMinutes: 1440,
    lookbackDays: 31,
  });
});

test('loadOrderSyncSettings lee la fila compartida', async () => {
  const db = {
    async query(sql, params = []) {
      if (String(sql).includes('select value from system_settings')) {
        assert.equal(params[0], ORDER_SYNC_SETTINGS_KEY);
        return { rows: [{ value: { intervalMinutes: 5, lookbackDays: 7 } }] };
      }
      return { rows: [] };
    },
  };
  assert.deepEqual(await loadOrderSyncSettings(db), {
    intervalMinutes: 5,
    lookbackDays: 7,
  });
});

test('saveOrderSyncSettings persiste un solo valor para Falabella y Ripley', async () => {
  const writes = [];
  const db = {
    async query(sql, params = []) {
      writes.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      if (String(sql).includes('select value from system_settings')) {
        return { rows: [{ value: { intervalMinutes: 15, lookbackDays: 5 } }] };
      }
      return { rows: [] };
    },
  };
  const saved = await saveOrderSyncSettings(db, { intervalMinutes: 1, lookbackDays: 7 }, 'admin-1');
  assert.deepEqual(saved, { intervalMinutes: 1, lookbackDays: 7 });
  const insert = writes.find((write) => write.sql.startsWith('insert into system_settings'));
  assert.equal(insert.params[0], ORDER_SYNC_SETTINGS_KEY);
  assert.deepEqual(JSON.parse(insert.params[1]), saved);
  assert.equal(insert.params[2], 'admin-1');
  assert.ok(writes.some((write) => write.sql.startsWith('update order_sync_state')));
  assert.ok(writes.some((write) => write.sql.startsWith('update falabella_sync_state')));
  assert.ok(writes.some((write) => write.sql.startsWith('update ripley_sync_state')));
});
