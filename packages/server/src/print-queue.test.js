import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LABELS_PER_PAGE,
  MAX_BATCH_LABELS,
  FLUSH_AFTER_MS,
  ackPrintBatch,
  bearerToken,
  claimNextBatch,
  hashPrintToken,
  isAutoPrintable,
  selectPrintBatch,
  skipPrintJobsForManualPrint,
  syncPrintJobForOrder,
  verifyStationToken,
} from './print-queue.js';

const NOW = new Date('2026-09-10T15:00:00.000Z');

function job(id, ageMs, status = 'pending') {
  return {
    id,
    orderId: 100 + id,
    status,
    createdAt: new Date(NOW.getTime() - ageMs).toISOString(),
  };
}

test('la hoja junta 4 etiquetas y no imprime con 1, 2 o 3', () => {
  assert.equal(LABELS_PER_PAGE, 4);
  assert.equal(selectPrintBatch([], { now: NOW }).reason, 'empty');
  assert.equal(selectPrintBatch([job(1, 0)], { now: NOW }).kind, 'wait');
  assert.equal(selectPrintBatch([job(1, 0), job(2, 0)], { now: NOW }).reason, 'gathering');
  assert.equal(selectPrintBatch([job(1, 0), job(2, 0), job(3, 0)], { now: NOW }).kind, 'wait');
});

test('con 4 pedidos imprime una página', () => {
  const decision = selectPrintBatch([job(1, 0), job(2, 0), job(3, 0), job(4, 0)], { now: NOW });
  assert.equal(decision.kind, 'print');
  assert.equal(decision.reason, 'page_full');
  assert.equal(decision.pages, 1);
  assert.deepEqual(decision.orderIds, [101, 102, 103, 104]);
});

test('con 7 u 8 pedidos imprime también, en dos páginas', () => {
  const seven = selectPrintBatch(Array.from({ length: 7 }, (_, index) => job(index + 1, 0)), { now: NOW });
  assert.equal(seven.kind, 'print');
  assert.equal(seven.pages, 2);
  assert.equal(seven.orderIds.length, 7);
  const eight = selectPrintBatch(Array.from({ length: 8 }, (_, index) => job(index + 1, 0)), { now: NOW });
  assert.equal(eight.pages, 2);
  assert.equal(eight.orderIds.length, 8);
});

test('con 9 pedidos imprime 8 y deja 1 para la siguiente hoja', () => {
  const decision = selectPrintBatch(Array.from({ length: 9 }, (_, index) => job(index + 1, 0)), { now: NOW });
  assert.equal(decision.orderIds.length, MAX_BATCH_LABELS);
  assert.equal(decision.pages, 2);
});

test('si no se juntan 4, la hora fuerza la impresión de lo que haya', () => {
  const early = selectPrintBatch([job(1, FLUSH_AFTER_MS - 1)], { now: NOW });
  assert.equal(early.kind, 'wait');
  const flush = selectPrintBatch([job(1, FLUSH_AFTER_MS), job(2, FLUSH_AFTER_MS / 2)], { now: NOW });
  assert.equal(flush.kind, 'print');
  assert.equal(flush.reason, 'hourly_flush');
  assert.equal(flush.orderIds.length, 2);
});

test('al prender la PC, 3 pedidos viejos salen; 3 recientes esperan', () => {
  const backlog = selectPrintBatch([
    job(1, 3 * FLUSH_AFTER_MS),
    job(2, 2 * FLUSH_AFTER_MS),
    job(3, FLUSH_AFTER_MS),
  ], { now: NOW });
  assert.equal(backlog.reason, 'hourly_flush');
  const fresh = selectPrintBatch([job(1, 5 * 60 * 1000), job(2, 60 * 1000), job(3, 0)], { now: NOW });
  assert.equal(fresh.reason, 'gathering');
});

test('solo Falabella listo y venta manual entran a la cola', () => {
  assert.equal(isAutoPrintable({ channelCode: 'manual', fulfillmentStatus: 'pending' }), true);
  assert.equal(isAutoPrintable({ channelCode: 'falabella', fulfillmentStatus: 'ready_to_ship' }), true);
  assert.equal(isAutoPrintable({ channelCode: 'falabella', fulfillmentStatus: 'pending' }), false);
  assert.equal(isAutoPrintable({ channelCode: 'ripley', fulfillmentStatus: 'ready_to_ship' }), false);
  assert.equal(isAutoPrintable({ channelCode: 'manual', fulfillmentStatus: 'delivered' }), false);
  assert.equal(isAutoPrintable({ channelCode: 'falabella', fulfillmentStatus: 'cancelled' }), false);
});

test('el token Bearer se lee del header', () => {
  assert.equal(bearerToken('Bearer zfprint_abc'), 'zfprint_abc');
  assert.equal(bearerToken('zfprint_abc'), '');
});

class QueueDb {
  constructor() {
    this.jobs = [];
    this.prints = new Map();
    this.stations = [{
      id: 'default',
      enabled: true,
      token_hash: hashPrintToken('secret-token'),
      token_suffix: 'oken',
      last_seen_at: null,
      last_batch_at: null,
      last_error: null,
    }];
    this.queries = [];
    this.nextId = 1;
  }

  async query(sql, params = []) {
    const compact = sql.replace(/\s+/g, ' ').trim();
    this.queries.push({ sql: compact, params });
    if (compact.includes('create table if not exists print_stations')) return { rows: [] };
    if (compact.startsWith('select print_count from logistics_label_prints')) {
      return { rows: this.prints.has(Number(params[0])) ? [{ print_count: this.prints.get(Number(params[0])) }] : [] };
    }
    if (compact.startsWith('insert into print_jobs (order_id, status) select $1')) {
      const orderId = Number(params[0]);
      const open = this.jobs.some((job) => job.order_id === orderId && ['pending', 'claimed'].includes(job.status));
      if (open) return { rows: [] };
      const row = {
        id: this.nextId,
        order_id: orderId,
        status: 'pending',
        batch_id: null,
        created_at: NOW.toISOString(),
      };
      this.nextId += 1;
      this.jobs.push(row);
      return { rows: [{ id: row.id }] };
    }
    if (compact.startsWith('insert into print_jobs (order_id, status) select o.id')) {
      return { rows: [] };
    }
    if (compact.startsWith('update print_jobs set status = $2') && compact.includes('order_id = any')) {
      const ids = params[0];
      const status = params[1];
      const changed = [];
      for (const job of this.jobs) {
        if (ids.includes(job.order_id) && ['pending', 'claimed'].includes(job.status)) {
          job.status = status;
          changed.push({ id: job.id });
        }
      }
      return { rows: changed };
    }
    if (compact.startsWith('update print_jobs pj set status = \'skipped_printed\'')) {
      const changed = [];
      for (const job of this.jobs) {
        if (job.status === 'pending' && this.prints.has(job.order_id)) {
          job.status = 'skipped_printed';
          changed.push({ id: job.id });
        }
      }
      return { rows: changed };
    }
    if (compact.startsWith('update print_jobs pj set status = \'skipped_unprintable\'')) {
      return { rows: [] };
    }
    if (compact.startsWith('update print_jobs set status = \'pending\'') && compact.includes('claim_expires_at')) {
      return { rows: [] };
    }
    if (compact.startsWith('select pj.id, pj.order_id, pj.status, pj.created_at')) {
      return {
        rows: this.jobs
          .filter((job) => job.status === 'pending')
          .map((job) => ({ id: job.id, order_id: job.order_id, status: job.status, created_at: job.created_at })),
      };
    }
    if (compact.startsWith('update print_jobs set status = \'claimed\'')) {
      const ids = params[0];
      const batchId = params[1];
      const changed = [];
      for (const job of this.jobs) {
        if (ids.includes(job.id) && job.status === 'pending') {
          job.status = 'claimed';
          job.batch_id = batchId;
          changed.push({ id: job.id, order_id: job.order_id });
        }
      }
      return { rows: changed };
    }
    if (compact.startsWith('select id, order_id, status from print_jobs where batch_id')) {
      return {
        rows: this.jobs
          .filter((job) => job.batch_id === params[0])
          .map((job) => ({ id: job.id, order_id: job.order_id, status: job.status })),
      };
    }
    if (compact.startsWith('insert into logistics_label_prints')) {
      for (const id of params[0]) this.prints.set(Number(id), (this.prints.get(Number(id)) || 0) + 1);
      return { rows: [] };
    }
    if (compact.startsWith('update print_jobs set status = \'done\'')) {
      for (const job of this.jobs) {
        if (params[0].includes(job.id) && job.status === 'claimed') job.status = 'done';
      }
      return { rows: [] };
    }
    if (compact.startsWith('select * from print_stations')) {
      return { rows: this.stations };
    }
    if (compact.startsWith('insert into print_stations')) {
      return { rows: [] };
    }
    return { rows: [] };
  }
}

test('no encola un pedido que ya se imprimió a mano', async () => {
  const db = new QueueDb();
  db.prints.set(44, 1);
  const result = await syncPrintJobForOrder(db, {
    orderId: 44,
    channelCode: 'manual',
    fulfillmentStatus: 'pending',
  });
  assert.equal(result.enqueued, false);
  assert.equal(result.reason, 'already_printed');
});

test('no encola Ripley ni Falabella pendiente', async () => {
  const db = new QueueDb();
  const ripley = await syncPrintJobForOrder(db, {
    orderId: 8,
    channelCode: 'ripley',
    fulfillmentStatus: 'ready_to_ship',
  });
  assert.equal(ripley.enqueued, false);
  const pending = await syncPrintJobForOrder(db, {
    orderId: 9,
    channelCode: 'falabella',
    fulfillmentStatus: 'pending',
  });
  assert.equal(pending.reason, 'unprintable');
});

test('un pedido printable entra una sola vez', async () => {
  const db = new QueueDb();
  const first = await syncPrintJobForOrder(db, {
    orderId: 21,
    channelCode: 'falabella',
    fulfillmentStatus: 'ready_to_ship',
  });
  const second = await syncPrintJobForOrder(db, {
    orderId: 21,
    channelCode: 'falabella',
    fulfillmentStatus: 'ready_to_ship',
  });
  assert.equal(first.enqueued, true);
  assert.equal(second.enqueued, false);
  assert.equal(db.jobs.length, 1);
});

test('imprimir en la bandeja saca el pedido de la cola', async () => {
  const db = new QueueDb();
  await syncPrintJobForOrder(db, { orderId: 5, channelCode: 'manual', fulfillmentStatus: 'pending' });
  await skipPrintJobsForManualPrint(db, [5]);
  assert.equal(db.jobs[0].status, 'skipped_manual');
});

test('la estación apagada escucha el ping pero no imprime', async () => {
  const db = new QueueDb();
  db.stations[0].enabled = false;
  await syncPrintJobForOrder(db, { orderId: 1, channelCode: 'manual', fulfillmentStatus: 'pending' });
  await syncPrintJobForOrder(db, { orderId: 2, channelCode: 'manual', fulfillmentStatus: 'pending' });
  await syncPrintJobForOrder(db, { orderId: 3, channelCode: 'manual', fulfillmentStatus: 'pending' });
  await syncPrintJobForOrder(db, { orderId: 4, channelCode: 'manual', fulfillmentStatus: 'pending' });
  const claimed = await claimNextBatch({ stationId: 'default', now: NOW }, db);
  assert.equal(claimed.kind, 'wait');
  assert.equal(claimed.reason, 'disabled');
});

test('con 4 pendientes la estación reclama el lote', async () => {
  const db = new QueueDb();
  for (const id of [1, 2, 3, 4]) {
    await syncPrintJobForOrder(db, { orderId: id, channelCode: 'manual', fulfillmentStatus: 'pending' });
  }
  const claimed = await claimNextBatch({ stationId: 'default', now: NOW }, db);
  assert.equal(claimed.kind, 'print');
  assert.equal(claimed.orderIds.length, 4);
  const ack = await ackPrintBatch({ batchId: claimed.batchId, orderIds: claimed.orderIds, printedBy: 'print-agent' }, db);
  assert.deepEqual(ack.printed, claimed.orderIds);
  assert.equal(db.prints.get(1), 1);
  assert.equal(db.jobs.filter((job) => job.status === 'done').length, 4);
});

test('si la bandeja imprimió mientras el agente tenía el lote, el ack no vuelve a contar', async () => {
  const db = new QueueDb();
  for (const id of [1, 2, 3, 4]) {
    await syncPrintJobForOrder(db, { orderId: id, channelCode: 'manual', fulfillmentStatus: 'pending' });
  }
  const claimed = await claimNextBatch({ stationId: 'default', now: NOW }, db);
  db.prints.set(1, 1);
  db.prints.set(2, 1);
  await skipPrintJobsForManualPrint(db, [1, 2]);
  const ack = await ackPrintBatch({ batchId: claimed.batchId, orderIds: claimed.orderIds }, db);
  assert.deepEqual(ack.printed.sort(), [3, 4]);
  assert.equal(db.prints.get(1), 1);
  assert.equal(db.prints.get(3), 1);
});

test('el token de estación coincide por hash', async () => {
  const db = new QueueDb();
  const ok = await verifyStationToken('secret-token', db, {});
  assert.equal(ok.id, 'default');
  const bad = await verifyStationToken('otro', db, {});
  assert.equal(bad, null);
  const env = await verifyStationToken('env-token', db, { PRINT_STATION_TOKEN: 'env-token' });
  assert.equal(env.source, 'env');
});
