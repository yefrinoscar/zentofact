import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueStockJob, ensureStockJobTables, processStockQueue } from './stock-jobs.js';

class JobDb {
  constructor() {
    this.jobs = new Map();
    this.nextId = 1;
    this.now = Date.now();
  }

  key(companyId, externalOrderId) {
    return `${companyId}:${externalOrderId}`;
  }

  async query(sql, params = []) {
    const compact = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (compact.startsWith('create table') || compact.startsWith('create index')) return { rows: [] };
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
});
