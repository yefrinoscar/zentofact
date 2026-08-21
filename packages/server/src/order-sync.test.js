import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverInterruptedOrderSyncRuns, syncRipleyPages } from './order-sync.js';

test('Ripley aísla el pedido fallido y continúa la página', async () => {
  const transactions = [];
  const db = {
    async query(sql) {
      transactions.push(sql);
      return { rows: [] };
    },
  };
  const ingested = [];
  const result = await syncRipleyPages(db, {
    channelAccountId: 12,
    companyId: 4,
    channelCode: 'ripley',
    displayName: 'Seller Ripley',
  }, {
    from: '2026-08-17T05:00:00.000Z',
    to: '2026-08-21T18:29:00.000Z',
  }, 99, {
    ripleyClient: {
      listOrders: async () => ({
        orders: [
          { orderId: 'OK-1', updatedAt: '2026-08-21T10:00:00Z' },
          { orderId: 'FAIL-2', updatedAt: '2026-08-21T11:00:00Z' },
          { orderId: 'OK-3', updatedAt: '2026-08-21T12:00:00Z' },
        ],
        totalCount: 3,
        max: 100,
      }),
    },
    ingestRipleyOrder: async ({ normalized }) => {
      if (normalized.orderId === 'FAIL-2') throw new Error('línea inválida');
      ingested.push(normalized.orderId);
      return { order: { id: ingested.length } };
    },
  });

  assert.deepEqual(ingested, ['OK-1', 'OK-3']);
  assert.deepEqual({
    pages: result.pages,
    received: result.received,
    upserted: result.upserted,
    failed: result.failed,
  }, { pages: 1, received: 3, upserted: 2, failed: 1 });
  assert.equal(typeof result.lastLogId, 'string');
  assert.equal(transactions.filter((sql) => sql === 'begin').length, 3);
  assert.equal(transactions.filter((sql) => sql === 'commit').length, 2);
  assert.equal(transactions.filter((sql) => sql === 'rollback').length, 1);
});

test('Ripley conserva la cabecera sin items y deja la ventana pendiente de reintento', async () => {
  const transactions = [];
  const db = {
    async query(sql) {
      transactions.push(sql);
      return { rows: [] };
    },
  };
  const result = await syncRipleyPages(db, {
    channelAccountId: 12,
    companyId: 4,
    channelCode: 'ripley',
    displayName: 'Seller Ripley',
  }, {
    from: '2026-08-17T05:00:00.000Z',
    to: '2026-08-21T18:29:00.000Z',
  }, 100, {
    ripleyClient: {
      listOrders: async () => ({
        orders: [{ orderId: 'PENDING-1', updatedAt: '2026-08-21T12:00:00Z' }],
        totalCount: 1,
        max: 100,
      }),
    },
    ingestRipleyOrder: async () => ({
      order: { id: 501 },
      itemsPending: true,
      itemsError: 'Ripley no devolvió order_lines para el pedido.',
    }),
  });

  assert.equal(result.upserted, 1);
  assert.equal(result.failed, 1);
  assert.equal(typeof result.lastLogId, 'string');
  assert.equal(transactions.filter((sql) => sql === 'commit').length, 1);
  assert.equal(transactions.filter((sql) => sql === 'rollback').length, 0);
});

test('al retomar una cuenta cierra las ejecuciones que quedaron running', async () => {
  const queries = [];
  const result = await recoverInterruptedOrderSyncRuns(12, {
    async query(sql) {
      queries.push(sql);
      return { rowCount: 3, rows: [] };
    },
  });

  assert.equal(result.recovered, 3);
  assert.match(queries[0], /update order_sync_runs/i);
  assert.match(queries[1], /update order_sync_state/i);
});
