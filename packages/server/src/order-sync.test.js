import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverInterruptedOrderSyncRuns, syncOrderAccount, syncOrders, syncRipleyPages } from './order-sync.js';

for (const scenario of [
  { name: 'no avanza el cursor cuando otro proceso ocupa el seller', response: { status: 'already_running' }, status: 'already_running', cursor: '2026-09-06T22:40:00Z' },
  { name: 'avanza el cursor si la consulta termina sin pedidos', response: { status: 'success', received: 0 }, status: 'success', cursor: '2026-09-06T22:51:00.000Z' },
  { name: 'conserva el cursor si un pedido falla', response: { status: 'partial', received: 2, upserted: 1, failed: 1 }, status: 'partial', cursor: '2026-09-06T22:40:00Z' },
]) {
test(`una cuenta Falabella ${scenario.name}`, async () => {
  let cursor = '2026-09-06T22:40:00Z';
  const db = {
    async query(sql, params = []) {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
      if (sql.includes('select a.id as channel_account_id')) return { rows: [{
        channel_account_id: 7, company_id: 1, channel_code: 'falabella',
        active: true, company_active: true, auto_create_orders: true,
        nombre_comercial: 'LIMBO', falabella_api_user_id: 'seller', falabella_api_key: 'test',
      }] };
      if (sql.includes('select * from order_sync_state')) return { rows: [{ cursor_updated_at: cursor }] };
      if (sql.includes('insert into order_sync_runs')) return { rows: [{ id: 9 }] };
      if (sql.includes('cursor_updated_at=case') && params[1] === 'success') cursor = params[3];
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const result = await syncOrderAccount(7, { now: '2026-09-06T22:52:00Z' }, {
    pool: { connect: async () => db },
    syncFalabellaOrders: async () => scenario.response,
  });
  assert.equal(cursor, scenario.cursor);
  assert.equal(result.status, scenario.status);
  assert.equal(result.companyName, 'LIMBO');
});
}

test('si Falabella está ocupada no deja last_error ni retrasa el próximo intento', async () => {
  const writes = [];
  const db = {
    async query(sql, params = []) {
      writes.push({ sql, params });
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
      if (sql.includes('select a.id as channel_account_id')) return { rows: [{
        channel_account_id: 7, company_id: 1, channel_code: 'falabella',
        active: true, company_active: true, auto_create_orders: true,
        nombre_comercial: 'BEAUTY HOMEHOLD', falabella_api_user_id: 'seller', falabella_api_key: 'test',
      }] };
      if (sql.includes('select * from order_sync_state')) {
        return { rows: [{ cursor_updated_at: '2026-09-06T22:40:00Z', status: 'success', last_attempt_at: '2026-09-06T22:30:00Z' }] };
      }
      if (sql.includes('insert into order_sync_runs')) return { rows: [{ id: 9 }] };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const result = await syncOrderAccount(7, { now: '2026-09-06T22:52:00Z' }, {
    pool: { connect: async () => db },
    syncFalabellaOrders: async () => ({ status: 'already_running' }),
  });
  assert.equal(result.status, 'already_running');
  assert.equal(result.companyName, 'BEAUTY HOMEHOLD');
  const stateWrite = writes.find((write) => write.sql.includes('last_attempt_at=$3'));
  assert.ok(stateWrite);
  assert.equal(stateWrite.params[1], 'success');
  assert.equal(stateWrite.params[2], '2026-09-06T22:30:00Z');
  assert.equal(writes.some((write) => write.sql.includes('last_error=$2')), false);
});

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
    ingestRipleyOrder: async ({ normalized, remapFromProvider }) => {
      if (normalized.orderId === 'FAIL-2') throw new Error('línea inválida');
      ingested.push({ orderId: normalized.orderId, remapFromProvider });
      return { order: { id: ingested.length } };
    },
  });

  assert.deepEqual(ingested, [
    { orderId: 'OK-1', remapFromProvider: false },
    { orderId: 'OK-3', remapFromProvider: false },
  ]);
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

test('el backfill pide a Ripley remapear el estado desde Mirakl', async () => {
  const remaps = [];
  await syncRipleyPages({
    async query() { return { rows: [] }; },
  }, {
    channelAccountId: 12,
    companyId: 4,
    channelCode: 'ripley',
    displayName: 'Seller Ripley',
  }, {
    from: '2026-09-01T05:00:00.000Z',
    to: '2026-09-08T04:59:59.999Z',
    creationRange: true,
    remapFromProvider: true,
  }, 101, {
    ripleyClient: {
      listOrders: async () => ({
        orders: [{
          orderId: 'R-SEP',
          createdAt: '2026-09-02T12:00:00Z',
          updatedAt: '2026-09-02T12:00:00Z',
        }],
        totalCount: 1,
        max: 100,
      }),
    },
    ingestRipleyOrder: async (input) => {
      remaps.push(input.remapFromProvider);
      return { order: { id: 1 } };
    },
  });
  assert.deepEqual(remaps, [true]);
});

test('Ripley reubica listos persistidos aunque Mirakl no los vuelva a mandar', async () => {
  const remapped = [];
  const db = {
    async query(sql) {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
      if (sql.includes('select a.id as channel_account_id')) return { rows: [{
        channel_account_id: 12, company_id: 4, channel_code: 'ripley',
        active: true, company_active: true, auto_create_orders: true,
        ripley_api_key: 'test',
      }] };
      if (sql.includes('select * from order_sync_state')) return { rows: [{ cursor_updated_at: '2026-09-07T12:00:00Z' }] };
      if (sql.includes('insert into order_sync_runs')) return { rows: [{ id: 22 }] };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  await syncOrderAccount(12, { now: '2026-09-07T18:00:00.000Z' }, {
    pool: { connect: async () => db },
    loadOrderSyncSettings: async () => ({ intervalMinutes: 15, lookbackDays: 5 }),
    getCompany: async () => ({ id: 4 }),
    remapPersistedRipleyReadyOrders: async (_db, accountId) => {
      remapped.push(accountId);
      return { updated: 2 };
    },
    ripleyClient: {
      listOrders: async () => ({ orders: [], totalCount: 0, max: 100 }),
    },
  });
  assert.deepEqual(remapped, [12]);
});

test('después de Mirakl, Ripley escucha el estado logístico de SVC', async () => {
  const logistics = [];
  const db = {
    async query(sql) {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
      if (sql.includes('select a.id as channel_account_id')) return { rows: [{
        channel_account_id: 12, company_id: 4, channel_code: 'ripley',
        active: true, company_active: true, auto_create_orders: true,
        ripley_api_key: 'test',
      }] };
      if (sql.includes('select * from order_sync_state')) return { rows: [{ cursor_updated_at: '2026-09-07T12:00:00Z' }] };
      if (sql.includes('insert into order_sync_runs')) return { rows: [{ id: 22 }] };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const result = await syncOrderAccount(12, { now: '2026-09-07T18:00:00.000Z' }, {
    pool: { connect: async () => db },
    loadOrderSyncSettings: async () => ({ intervalMinutes: 15, lookbackDays: 5 }),
    getCompany: async (companyId) => ({
      id: companyId,
      ripleySvcUsername: 'limbo',
      ripleySvcPassword: 'clave',
    }),
    remapPersistedRipleyReadyOrders: async () => ({ updated: 0 }),
    ripleyClient: {
      listOrders: async () => ({ orders: [], totalCount: 0, max: 100 }),
    },
    syncLogistics: async (company) => {
      logistics.push(company.id);
      return { received: 2, matched: 2 };
    },
  });
  assert.deepEqual(logistics, [4]);
  assert.deepEqual(result.logistics, { received: 2, matched: 2 });
});

test('Falabella sigue reconciliando si la ventana incremental ya está al día', async () => {
  const called = [];
  const db = {
    async query(sql) {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
      if (sql.includes('select a.id as channel_account_id')) return { rows: [{
        channel_account_id: 7, company_id: 1, channel_code: 'falabella',
        active: true, company_active: true, auto_create_orders: true,
        nombre_comercial: 'LIMBO', falabella_api_user_id: 'seller', falabella_api_key: 'test',
      }] };
      if (sql.includes('select * from order_sync_state')) return { rows: [{ cursor_updated_at: '2026-09-07T18:20:00.000Z' }] };
      if (sql.includes('insert into order_sync_runs')) return { rows: [{ id: 11 }] };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const result = await syncOrderAccount(7, { now: '2026-09-07T18:00:00.000Z' }, {
    pool: { connect: async () => db },
    loadOrderSyncSettings: async () => ({ intervalMinutes: 15, lookbackDays: 5 }),
    syncFalabellaOrders: async (companyId, options) => {
      called.push({ companyId, options });
      return { status: 'success', skipped: 'already_current', received: 0, lastLogId: null };
    },
  });
  assert.deepEqual(called, [{ companyId: 1, options: { mode: 'incremental' } }]);
  assert.equal(result.status, 'success');
  assert.equal(result.skipped, 'already_current');
});

test('un backfill sin fechas usa la ventana compartida', async () => {
  const windows = [];
  const db = {
    async query(sql) {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
      if (sql.includes('select a.id as channel_account_id')) return { rows: [{
        channel_account_id: 7, company_id: 1, channel_code: 'falabella',
        active: true, company_active: true, auto_create_orders: true,
        nombre_comercial: 'LIMBO', falabella_api_user_id: 'seller', falabella_api_key: 'test',
      }] };
      if (sql.includes('select * from order_sync_state')) return { rows: [{ cursor_updated_at: '2026-09-07T12:00:00Z' }] };
      if (sql.includes('insert into order_sync_runs')) return { rows: [{ id: 11 }] };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  await syncOrderAccount(7, { mode: 'backfill', now: '2026-09-07T18:00:00.000Z', lookbackDays: 7 }, {
    pool: { connect: async () => db },
    loadOrderSyncSettings: async () => ({ intervalMinutes: 15, lookbackDays: 5 }),
    syncFalabellaOrders: async (_companyId, options) => {
      windows.push(options);
      return { status: 'success', received: 0 };
    },
  });
  assert.deepEqual(windows, [{
    mode: 'range_created',
    from: '2026-09-01T05:00:00.000Z',
    to: '2026-09-08T04:59:59.999Z',
  }]);
});

test('Sincronizar cierra pedidos marketplace ya enviados antes de llamar al canal', async () => {
  const closed = [];
  const result = await syncOrders({}, {
    db: { async query() { return { rows: [] }; } },
    closeStaleMarketplaceFulfillment: async (db) => {
      closed.push(Boolean(db));
      return { falabella: 4, ripley: 1 };
    },
    loadOrderSyncSettings: async () => ({ intervalMinutes: 15, lookbackDays: 5 }),
  });
  assert.deepEqual(closed, [true]);
  assert.deepEqual(result.results, []);
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
