import { applyReadyOrderStock } from './catalog-operations.js';
import { limaDate, limaDaySql, limaToday } from './product-service.js';
import { loadCore } from './utils.js';

const READY_FULFILLMENT_SQL = `'ready_to_ship','shipped','delivered'`;
const MAX_ATTEMPTS = 6;
const STALE_PROCESSING_MS = 60_000;
const DEFAULT_LIMIT = 8;
const WORKER_INTERVAL_MS = 5_000;
const log = (...args) => console.log('[stock-jobs]', ...args);

function limaOffset(days) {
  const [year, month, day] = limaToday().split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function text(value, max = 300) {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, max) : '';
}

async function target(db) {
  return db || (await loadCore()).pool;
}

export async function ensureStockJobTables(db) {
  const client = await target(db);
  await client.query(`
    create table if not exists inventory_stock_jobs (
      id bigserial primary key,
      company_id integer not null,
      external_order_id text not null,
      order_number text,
      status text not null default 'pending',
      attempts integer not null default 0,
      last_error text,
      result jsonb not null default '{}'::jsonb,
      source text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      next_attempt_at timestamptz,
      unique (company_id, external_order_id)
    );
    create index if not exists idx_inventory_stock_jobs_pending
      on inventory_stock_jobs (created_at)
      where status = 'pending';
  `);
}

export async function enqueueStockJob(input = {}, db) {
  const companyId = Number(input.companyId);
  const externalOrderId = text(input.externalOrderId);
  if (!Number.isInteger(companyId) || companyId <= 0 || !externalOrderId) {
    return { enqueued: false, ignored: 'pedido inválido' };
  }
  const client = await target(db);
  const result = await client.query(
    `insert into inventory_stock_jobs (
       company_id, external_order_id, order_number, status, source, created_at, updated_at
     ) values ($1,$2,$3,'pending',$4,now(),now())
     on conflict (company_id, external_order_id) do update set
       order_number=coalesce(nullif(excluded.order_number, ''), inventory_stock_jobs.order_number),
       status=case
         when inventory_stock_jobs.status in ('failed','skipped') then 'pending'
         else inventory_stock_jobs.status
       end,
       next_attempt_at=case
         when inventory_stock_jobs.status in ('failed','skipped') then null
         else inventory_stock_jobs.next_attempt_at
       end,
       updated_at=now()
     returning *`,
    [companyId, externalOrderId, text(input.orderNumber) || null, text(input.source, 50) || 'system'],
  );
  const job = result.rows[0];
  return {
    enqueued: job?.status === 'pending',
    already: job?.status !== 'pending',
    job: mapJob(job),
  };
}

function mapJob(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    companyId: Number(row.company_id),
    externalOrderId: row.external_order_id,
    orderNumber: row.order_number,
    status: row.status,
    attempts: Number(row.attempts || 0),
    lastError: row.last_error || null,
    result: row.result || {},
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nextAttemptAt: row.next_attempt_at,
  };
}

async function finishJob(client, job, status, { error = null, result = {}, retry = false } = {}) {
  const failed = retry && Number(job.attempts || 0) >= MAX_ATTEMPTS;
  const nextStatus = failed ? 'failed' : (retry ? 'pending' : status);
  const backoffSec = Math.min(300, 5 * Math.max(1, Number(job.attempts || 1)));
  await client.query(
    `update inventory_stock_jobs
     set status=$2,
         last_error=$3,
         result=$4::jsonb,
         next_attempt_at=case when $2='pending' then now() + ($5::int * interval '1 second') else null end,
         updated_at=now()
     where id=$1 and status='processing'`,
    [job.id, nextStatus, error, JSON.stringify(result || {}), backoffSec],
  );
  return nextStatus;
}

export async function processStockQueue(input = {}, db) {
  const limit = Math.min(Math.max(Number(input.limit) || DEFAULT_LIMIT, 1), 50);
  const apply = input.apply || applyReadyOrderStock;
  const client = await target(db);
  await client.query(
    `update inventory_stock_jobs
     set status='pending',
         last_error=coalesce(last_error, 'timeout de procesamiento'),
         next_attempt_at=now(),
         updated_at=now()
     where status='processing'
       and updated_at < now() - ($1::int * interval '1 millisecond')`,
    [STALE_PROCESSING_MS],
  );
  const claimed = await client.query(
    `update inventory_stock_jobs set status='processing', attempts=attempts+1, updated_at=now()
     where id in (
       select id from inventory_stock_jobs
       where status='pending' and (next_attempt_at is null or next_attempt_at <= now())
       order by created_at asc
       limit $1
       for update skip locked
     )
     returning *`,
    [limit],
  );
  const stats = { claimed: claimed.rows.length, done: 0, failed: 0, retried: 0, applied: 0, skipped: 0 };
  for (const row of claimed.rows) {
    const job = mapJob(row);
    try {
      const result = await apply({
        companyId: job.companyId,
        externalOrderId: job.externalOrderId,
        source: job.source || 'webhook',
      }, db);
      if (result?.missing) {
        const next = await finishJob(client, job, 'pending', {
          retry: true,
          error: 'Pedido canónico todavía no está disponible.',
          result,
        });
        if (next === 'failed') stats.failed += 1;
        else stats.retried += 1;
        continue;
      }
      await finishJob(client, job, 'done', { result });
      stats.done += 1;
      stats.applied += Number(result?.applied || 0);
      stats.skipped += Number(result?.skipped || 0);
    } catch (error) {
      const next = await finishJob(client, job, 'pending', {
        retry: true,
        error: String(error?.message || error).slice(0, 2000),
      });
      if (next === 'failed') stats.failed += 1;
      else stats.retried += 1;
      log(`job ${job.id} ${job.orderNumber || job.externalOrderId}:`, error?.message || error);
    }
  }
  return stats;
}

export async function enqueueStockJobsForOperationalDate(input = {}, db) {
  const date = limaDate(input.date || limaOffset(-1));
  const client = await target(db);
  const orders = await client.query(
    `select o.company_id, o.external_order_id, o.external_order_number
     from orders o
     left join falabella_orders fo
       on fo.company_id=o.company_id and fo.order_id=o.external_order_id
     where o.order_status not in ('cancelled','failed')
       and (
         o.fulfillment_status in (${READY_FULFILLMENT_SQL})
         or lower(coalesce(fo.status, '')) ~ '(ready_to_ship|shipped|delivered)'
       )
       and ${limaDaySql('coalesce(o.promised_shipping_at, o.ordered_at)')}
     order by o.id`,
    [date],
  );
  if (input.dryRun === true) {
    return { date, dryRun: true, orders: orders.rows.length, enqueued: 0, already: 0 };
  }
  let enqueued = 0;
  let already = 0;
  for (const row of orders.rows) {
    const result = await enqueueStockJob({
      companyId: row.company_id,
      externalOrderId: row.external_order_id,
      orderNumber: row.external_order_number,
      source: input.source || 'catchup',
    }, db);
    if (result.enqueued) enqueued += 1;
    else already += 1;
  }
  return { date, orders: orders.rows.length, enqueued, already };
}

export async function drainStockQueue(input = {}, db) {
  const maxLoops = Math.min(Math.max(Number(input.maxLoops) || 200, 1), 2000);
  const totals = { loops: 0, claimed: 0, done: 0, failed: 0, retried: 0, applied: 0, skipped: 0 };
  for (let loop = 0; loop < maxLoops; loop += 1) {
    const stats = await processStockQueue({ limit: input.limit, apply: input.apply }, db);
    totals.loops += 1;
    totals.claimed += stats.claimed;
    totals.done += stats.done;
    totals.failed += stats.failed;
    totals.retried += stats.retried;
    totals.applied += stats.applied;
    totals.skipped += stats.skipped;
    if (!stats.claimed) break;
  }
  return totals;
}

export function startStockJobWorker() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const stats = await processStockQueue();
      if (stats.claimed) log(JSON.stringify(stats));
    } catch (error) {
      log('worker error:', error?.message || error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { tick().catch(() => {}); }, WORKER_INTERVAL_MS);
  timer.unref?.();
  setTimeout(() => { tick().catch(() => {}); }, 3_000).unref?.();
  log(`activo. worker cada ${WORKER_INTERVAL_MS / 1000}s, hasta ${DEFAULT_LIMIT} jobs.`);
  return timer;
}
