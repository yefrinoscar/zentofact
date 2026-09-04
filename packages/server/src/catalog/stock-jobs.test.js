import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  enqueueStockJob,
  enqueueStockJobsSinceListenFrom,
  ensureStockJobTables,
  getConfig,
  getPaused,
  jobOrderPreview,
  processStockQueue,
  recentJobs,
  runStockReconciliation,
  reopenReservedStockJobsForCommit,
  setPaused,
} from './stock-jobs.js';
import { INVENTORY_LISTEN_FROM_AT } from './stock-commitment.js';
import { invalidateSystemConfigCache } from '../system-config.js';

class JobDb {
  constructor() {
    this.jobs = new Map();
    this.nextId = 1;
    this.now = Date.now();
    this.paused = false;
    this.settings = { catalog_inventory: true };
  }

  key(companyId, externalOrderId) {
    return `${companyId}:${externalOrderId}`;
  }

  async query(sql, params = []) {
    const compact = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (compact.includes('pg_advisory_lock') || compact.includes('pg_advisory_xact_lock')) {
      return { rows: [{ pg_advisory_lock: true }] };
    }
    if (compact.includes('pg_advisory_unlock')) return { rows: [{ pg_advisory_unlock: true }] };
    if (compact.includes('select key, value from system_settings')) {
      return {
        rows: Object.entries(this.settings).map(([key, enabled]) => ({
          key,
          value: { enabled },
        })),
      };
    }
    if (compact.includes('from inventory_stock_jobs group by status')) {
      const counts = new Map();
      for (const job of this.jobs.values()) {
        counts.set(job.status, (counts.get(job.status) || 0) + 1);
      }
      return { rows: [...counts.entries()].map(([status, n]) => ({ status, n })) };
    }
    if (compact.startsWith('select id, company_id, external_order_id, external_order_number from orders')) {
      return { rows: [] };
    }
    if (compact.includes('select paused from inventory_stock_state')) {
      return { rows: [{ paused: this.paused }] };
    }
    if (compact.includes('select last_reconciled_at')) {
      return { rows: [{
        last_reconciled_at: '2026-09-03T23:30:00.000Z',
        last_reconciliation: { enqueued: 2 },
        last_reconciliation_error: null,
      }] };
    }
    if (compact.includes('insert into inventory_stock_state')) {
      this.paused = !!params[0];
      return { rows: [] };
    }
    if (compact.startsWith('create table') || compact.startsWith('create index') || compact.startsWith('insert into inventory_stock_state')) return { rows: [] };
    if (compact.includes('where status=\'processing\'') && compact.includes('timeout')) {
      return { rows: [] };
    }
    if (compact.startsWith('insert into inventory_stock_jobs')) {
      const [companyId, externalOrderId, orderNumber, source] = params;
      const key = this.key(companyId, externalOrderId);
      const existing = this.jobs.get(key);
      if (existing) {
        if (existing.status === 'failed' || existing.status === 'skipped') {
          existing.status = 'pending';
          existing.next_attempt_at = null;
        }
        existing.order_number = orderNumber || existing.order_number;
        existing.updated_at = new Date().toISOString();
        return { rows: [existing] };
      }
      const row = {
        id: this.nextId++,
        company_id: companyId,
        external_order_id: externalOrderId,
        order_number: orderNumber,
        status: 'pending',
        attempts: 0,
        last_error: null,
        result: {},
        source,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        next_attempt_at: null,
      };
      this.jobs.set(key, row);
      return { rows: [row] };
    }
    if (compact.includes('set status=\'processing\'') && compact.includes('for update skip locked')) {
      const limit = Number(params[0] || 8);
      const claimed = [...this.jobs.values()]
        .filter((job) => job.status === 'pending')
        .sort((left, right) => Number(left.id) - Number(right.id))
        .slice(0, limit)
        .map((job) => {
          job.status = 'processing';
          job.attempts += 1;
          job.updated_at = new Date().toISOString();
          return { ...job };
        });
      return { rows: claimed };
    }
    if (compact.startsWith('update inventory_stock_jobs') && compact.includes('status=$2')) {
      const [id, status, error, result] = params;
      const job = [...this.jobs.values()].find((row) => Number(row.id) === Number(id));
      if (!job || job.status !== 'processing') return { rows: [] };
      job.status = status;
      job.last_error = error;
      job.result = typeof result === 'string' ? JSON.parse(result) : result;
      job.next_attempt_at = status === 'pending' ? new Date(Date.now() + 5000).toISOString() : null;
      job.updated_at = new Date().toISOString();
      return { rows: [job] };
    }
    throw new Error(`Query no simulada: ${compact}`);
  }
}

beforeEach(() => {
  invalidateSystemConfigCache();
});

test('encolar el mismo pedido dos veces no duplica el job', async () => {
  const db = new JobDb();
  const first = await enqueueStockJob({
    companyId: 1, externalOrderId: '5001', orderNumber: '3248', source: 'webhook',
  }, db);
  const second = await enqueueStockJob({
    companyId: 1, externalOrderId: '5001', orderNumber: '3248', source: 'webhook',
  }, db);
  assert.equal(first.enqueued, true);
  assert.equal(second.enqueued, true);
  assert.equal(db.jobs.size, 1);
  assert.equal([...db.jobs.values()][0].status, 'pending');
});

test('el worker descuenta en lote y marca el job como done', async () => {
  const db = new JobDb();
  await enqueueStockJob({ companyId: 1, externalOrderId: 'A', orderNumber: '1', source: 'webhook' }, db);
  await enqueueStockJob({ companyId: 2, externalOrderId: 'B', orderNumber: '2', source: 'webhook' }, db);
  const applied = [];
  const stats = await processStockQueue({
    apply: async (input) => {
      applied.push(input.externalOrderId);
      return { applied: 1, skipped: 0, orderId: 10 };
    },
  }, db);
  assert.deepEqual(applied, ['A', 'B']);
  assert.equal(stats.claimed, 2);
  assert.equal(stats.done, 2);
  assert.equal(stats.applied, 2);
  assert.equal([...db.jobs.values()].every((job) => job.status === 'done'), true);
});

test('un job explícito reintenta las líneas históricas que ya están listas para enviar', async () => {
  const db = new JobDb();
  await enqueueStockJob({ companyId: 1, externalOrderId: 'A', orderNumber: '1', source: 'catchup' }, db);
  const inputs = [];

  await processStockQueue({
    apply: async (input) => {
      inputs.push(input);
      return { applied: 1, skipped: 0, orderId: 10 };
    },
  }, db);

  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].includeSkippedPolicy, true);
});

test('un job done no se vuelve a procesar al reencolar', async () => {
  const db = new JobDb();
  await enqueueStockJob({ companyId: 1, externalOrderId: 'A', orderNumber: '1' }, db);
  await processStockQueue({ apply: async () => ({ applied: 1 }) }, db);
  const again = await enqueueStockJob({ companyId: 1, externalOrderId: 'A', orderNumber: '1' }, db);
  assert.equal(again.enqueued, false);
  assert.equal(again.job.status, 'done');
  const stats = await processStockQueue({ apply: async () => ({ applied: 99 }) }, db);
  assert.equal(stats.claimed, 0);
});

test('si el pedido aún no está, reintenta; al sexto intento falla', async () => {
  const db = new JobDb();
  await enqueueStockJob({ companyId: 1, externalOrderId: 'MISSING' }, db);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const stats = await processStockQueue({ apply: async () => ({ missing: true }) }, db);
    assert.equal(stats.retried, 1);
    assert.equal([...db.jobs.values()][0].status, 'pending');
    [...db.jobs.values()][0].next_attempt_at = null;
  }
  const last = await processStockQueue({ apply: async () => ({ missing: true }) }, db);
  assert.equal(last.failed, 1);
  assert.equal([...db.jobs.values()][0].status, 'failed');
});

test('una cabecera sin artículos completos no puede quedar como descontada', async () => {
  const db = new JobDb();
  await enqueueStockJob({ companyId: 1, externalOrderId: 'PENDING-ITEMS', orderNumber: '3250692389' }, db);

  const stats = await processStockQueue({
    apply: async () => ({
      orderId: 186824,
      orderNumber: '3250692389',
      itemCount: 0,
      itemsPending: true,
      applied: 0,
      skipped: 0,
    }),
  }, db);

  const [job] = db.jobs.values();
  assert.equal(stats.done, 0);
  assert.equal(stats.retried, 1);
  assert.equal(job.status, 'pending');
  assert.match(job.last_error, /artículos/i);
});

test('el detalle del job identifica cada línea y su producto maestro', async () => {
  const db = {
    async query(sql) {
      const compact = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
      if (compact.includes('from inventory_stock_jobs j')) {
        return { rows: [{
          id: 12,
          company_id: 9,
          external_order_id: '5005215407',
          order_id: '186824',
          order_number: '3250692389',
          source: 'cron',
          result: { reserved: 1 },
          company: 'HIGHER',
        }] };
      }
      if (compact.includes('from orders o') && compact.includes('items_count')) {
        return { rows: [{
          id: '186824',
          external_order_number: '3250692389',
          order_status: 'confirmed',
          fulfillment_status: 'pending',
          items_status: 'complete',
          total: '34.99',
          items_count: 1,
          stock_applied: 0,
        }] };
      }
      if (compact.includes('from order_items oi')) {
        return { rows: [{
          id: '991',
          description: 'Camiseta reductora negra M',
          seller_sku: 'AG83',
          provider_sku: 'PMP-AG83',
          quantity: '1',
          product_id: '21',
          main_sku: 'H9MN',
          product_name: 'Camiseta reductora',
          stock_state: 'pending',
        }] };
      }
      throw new Error(`Query no simulada: ${compact}`);
    },
  };

  const preview = await jobOrderPreview(12, db);
  assert.equal(preview.order.itemsStatus, 'complete');
  assert.deepEqual(preview.items, [{
    id: 991,
    title: 'Camiseta reductora',
    description: 'Camiseta reductora negra M',
    sellerSku: 'AG83',
    providerSku: 'PMP-AG83',
    quantity: 1,
    productId: 21,
    mainSku: 'H9MN',
    stockState: 'pending',
  }]);
});

test('la tabla de jobs incluye productos y estado actual del stock', async () => {
  let query = '';
  const rows = await recentJobs(10, {
    async query(sql) {
      query = String(sql);
      return { rows: [{
        id: 12,
        items: [{ id: 991, title: 'Camiseta reductora', mainSku: 'H9MN' }],
        reserved_units: '1',
        applied_units: '0',
        unmatched_items: 0,
      }] };
    },
  });

  assert.equal(rows[0].items[0].mainSku, 'H9MN');
  assert.match(query, /jsonb_agg/i);
  assert.match(query, /reserved_units/i);
  assert.match(query, /unmatched_items/i);
  assert.match(query, /product_id is null/i);
});

test('la cola separa la identidad canónica de la compatibilidad legacy', async () => {
  let migrationSql = '';
  await ensureStockJobTables({
    async query(sql) {
      migrationSql += sql;
      return { rows: [] };
    },
  });

  assert.match(migrationSql, /drop constraint if exists inventory_stock_jobs_company_id_external_order_id_key/i);
  assert.match(migrationSql, /where order_id is null/i);
  assert.match(migrationSql, /matched_orders[\s\S]*having count\(\*\)=1/i);
  assert.match(migrationSql, /existing\.order_id=matched\.order_id/i);
});

test('pausar la cola detiene el procesamiento', async () => {
  const db = new JobDb();
  await enqueueStockJob({ companyId: 1, externalOrderId: 'A', orderNumber: '1' }, db);
  await setPaused(true, db);
  const stats = await processStockQueue({ apply: async () => ({ applied: 1 }) }, db);
  assert.equal(stats.paused, true);
  assert.equal(stats.claimed, 0);
  await setPaused(false, db);
  const resumed = await processStockQueue({ apply: async () => ({ applied: 1 }) }, db);
  assert.equal(resumed.claimed, 1);
});

test('la cola muestra el mismo descuento que Configuración del sistema', async () => {
  const db = new JobDb();
  db.settings = { catalog_inventory: true };
  const on = await getConfig(db);
  assert.equal(on.inventoryEnabled, true);
  assert.equal(on.inventoryLabel, 'Descuento de inventario desde pendiente');
  assert.equal(on.inventorySourceLabel, 'Base de datos');
  assert.equal(on.inventoryKillSwitch, false);
  assert.equal(on.reconciliationIntervalSeconds, 60);
  assert.equal(on.lastReconciledAt, '2026-09-03T23:30:00.000Z');

  invalidateSystemConfigCache();
  db.settings = { catalog_inventory: false };
  const off = await getConfig(db);
  assert.equal(off.inventoryEnabled, false);
  assert.equal(off.inventorySourceLabel, 'Base de datos');
});

test('el cron reconcilia pedidos elegibles sin depender del webhook', async () => {
  const calls = [];
  const records = [];
  const result = await runStockReconciliation({}, null, {
    getPaused: async () => false,
    enqueueSince: async (input) => {
      calls.push(input);
      return { orders: 2, enqueued: 2, already: 0 };
    },
    reopen: async () => ({ reopened: 1 }),
    record: async (value) => { records.push(value); },
  });

  assert.deepEqual(calls, [{ source: 'cron' }]);
  assert.deepEqual(result, {
    paused: false,
    listened: { orders: 2, enqueued: 2, already: 0 },
    reopened: { reopened: 1 },
  });
  assert.deepEqual(records, [result]);
});

test('con el descuento apagado el worker no procesa la cola', async () => {
  const db = new JobDb();
  db.settings = { catalog_inventory: false };
  await enqueueStockJob({ companyId: 1, externalOrderId: 'A', orderNumber: '1', source: 'webhook' }, db);
  const stats = await processStockQueue({ apply: async () => ({ applied: 1 }) }, db);
  assert.equal(stats.inventoryDisabled, true);
  assert.equal(stats.claimed, 0);
  assert.equal([...db.jobs.values()][0].status, 'pending');
});

test('la escucha encola pedidos operativos desde las 12:00 Lima del corte', async () => {
  let sql = '';
  let params = [];
  const preview = await enqueueStockJobsSinceListenFrom({
    dryRun: true,
    source: 'listen',
  }, {
    async query(text, values = []) {
      sql = String(text);
      params = values;
      return { rows: [{ order_id: 1 }] };
    },
  });
  assert.equal(preview.orders, 1);
  assert.equal(preview.enqueued, 0);
  assert.equal(params[0], INVENTORY_LISTEN_FROM_AT);
  assert.match(sql, /fulfillment_status in \('pending','preparing','ready_to_ship','shipped','delivered'\)/i);
  assert.match(sql, /o\.ordered_at >= \$1::timestamptz/i);
  assert.match(sql, /oi\.stock_state in \('none','skipped_policy','skipped_unmapped','skipped_insufficient'\)/i);
  assert.equal(/o\.ordered_at is null/i.test(sql), false);
});

test('reabre un job done cuando la reserva debe confirmarse', async () => {
  let sql = '';
  const result = await reopenReservedStockJobsForCommit({
    async query(text) {
      sql = String(text);
      return { rows: [{ id: 9 }] };
    },
  });
  assert.equal(result.reopened, 1);
  assert.match(sql, /stock_state='pending'/i);
  assert.match(sql, /ready_to_ship/i);
  assert.match(sql, /job\.status='done'/i);
});
