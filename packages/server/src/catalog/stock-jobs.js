import { applyReadyOrderStock } from './catalog-operations.js';
import { catalogInventoryFlagState, isCatalogInventoryEnabled } from '../system-config.js';
import { limaDate, limaDaySql, limaToday } from './product-service.js';
import { INVENTORY_LISTEN_FROM_AT } from './stock-commitment.js';
import { loadCore } from './utils.js';

const READY_FULFILLMENT_SQL = `'ready_to_ship','shipped','delivered'`;
const MAX_ATTEMPTS = 6;
const STALE_PROCESSING_MS = 60_000;
const DEFAULT_LIMIT = 8;
const WORKER_INTERVAL_MS = 5_000;
const RECONCILIATION_INTERVAL_MS = 60_000;
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

function isPool(source) {
  return typeof source?.connect === 'function' && typeof source?.totalCount === 'number';
}

async function withPinnedClient(db, work) {
  const source = await target(db);
  if (!isPool(source)) return work(source, false);
  const client = await source.connect();
  try {
    return await work(client, true);
  } finally {
    client.release();
  }
}

function identityLockKey(companyId, externalOrderId) {
  return `inventory-stock:${companyId}:${externalOrderId}`;
}

async function withIdentityLock(db, companyId, externalOrderId, work) {
  const source = await target(db);
  const ownsConnection = isPool(source);
  const client = ownsConnection ? await source.connect() : source;
  const lockKey = identityLockKey(companyId, externalOrderId);
  if (ownsConnection) await client.query('begin');
  try {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);
    const result = await work(client);
    if (ownsConnection) await client.query('commit');
    return result;
  } catch (error) {
    if (ownsConnection) await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    if (ownsConnection) client.release();
  }
}

export async function ensureStockJobTables(db) {
  await withPinnedClient(db, async (client, ownsTransaction) => {
    if (ownsTransaction) await client.query('begin');
    try {
      await client.query("select pg_advisory_xact_lock(hashtextextended('inventory-stock-job-migration', 0))");
      await client.query(`
    create table if not exists inventory_stock_jobs (
      id bigserial primary key,
      order_id bigint references orders(id) on delete cascade,
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
      next_attempt_at timestamptz
    );
    alter table inventory_stock_jobs
      add column if not exists order_id bigint references orders(id) on delete cascade;
    alter table inventory_stock_jobs
      drop constraint if exists inventory_stock_jobs_company_id_external_order_id_key;
    lock table inventory_stock_jobs in share row exclusive mode;
    create unique index if not exists idx_inventory_stock_jobs_order
      on inventory_stock_jobs (order_id) where order_id is not null;
    create unique index if not exists idx_inventory_stock_jobs_legacy_identity
      on inventory_stock_jobs (company_id, external_order_id) where order_id is null;
    with matched_orders as (
      select job.id as job_id, min(order_row.id) as order_id
      from inventory_stock_jobs job
      join orders order_row
        on order_row.company_id=job.company_id
       and order_row.external_order_id=job.external_order_id
      where job.order_id is null
      group by job.id
      having count(*)=1
    ), unique_matches as (
      select matched.job_id, matched.order_id
      from matched_orders matched
      where not exists (
        select 1
        from inventory_stock_jobs existing
        where existing.order_id=matched.order_id
      )
    )
    update inventory_stock_jobs job
       set order_id=matched.order_id, updated_at=now()
      from unique_matches matched
     where job.id=matched.job_id;
    with completed_duplicates as (
      select legacy.id as legacy_id, canonical.id as canonical_id
      from inventory_stock_jobs legacy
      join orders order_row
        on order_row.company_id=legacy.company_id
       and order_row.external_order_id=legacy.external_order_id
      join inventory_stock_jobs canonical on canonical.order_id=order_row.id
      where legacy.order_id is null
        and legacy.status='done'
        and (select count(*) from orders candidate
             where candidate.company_id=legacy.company_id
              and candidate.external_order_id=legacy.external_order_id)=1
    )
    update inventory_stock_jobs canonical
       set status='done', next_attempt_at=null, updated_at=now()
      from completed_duplicates duplicate
     where canonical.id=duplicate.canonical_id
       and canonical.status in ('pending','processing','failed','skipped');
    with duplicates as (
      select legacy.id as legacy_id, canonical.order_id
      from inventory_stock_jobs legacy
      join orders order_row
        on order_row.company_id=legacy.company_id
       and order_row.external_order_id=legacy.external_order_id
      join inventory_stock_jobs canonical on canonical.order_id=order_row.id
      where legacy.order_id is null
        and (select count(*) from orders candidate
             where candidate.company_id=legacy.company_id
              and candidate.external_order_id=legacy.external_order_id)=1
    )
    update inventory_stock_jobs legacy
       set status=case
             when legacy.status in ('pending','processing','failed') then 'skipped'
             else legacy.status
           end,
           last_error=null,
           next_attempt_at=null,
           result=coalesce(legacy.result, '{}'::jsonb) || jsonb_build_object(
             'supersededByOrderId', duplicate.order_id,
             'supersededAt', now()
           ),
           updated_at=now()
      from duplicates duplicate
     where legacy.id=duplicate.legacy_id
       and (
         legacy.status in ('pending','processing','failed')
         or legacy.result->>'supersededByOrderId' is distinct from duplicate.order_id::text
       );
    create index if not exists idx_inventory_stock_jobs_pending
      on inventory_stock_jobs (created_at)
      where status = 'pending';
    create table if not exists inventory_stock_state (
      id integer primary key,
      paused boolean not null default false,
      updated_at timestamptz not null default now()
    );
    alter table inventory_stock_state add column if not exists last_reconciled_at timestamptz;
    alter table inventory_stock_state add column if not exists last_reconciliation jsonb not null default '{}'::jsonb;
    alter table inventory_stock_state add column if not exists last_reconciliation_error text;
    insert into inventory_stock_state (id, paused) values (1, false)
    on conflict (id) do nothing;
  `);
      if (ownsTransaction) await client.query('commit');
    } catch (error) {
      if (ownsTransaction) await client.query('rollback').catch(() => {});
      throw error;
    }
  });
}

export async function getPaused(db) {
  const client = await target(db);
  const result = await client.query('select paused from inventory_stock_state where id=1');
  return result.rows[0]?.paused === true;
}

export async function setPaused(paused, db) {
  const client = await target(db);
  await client.query(
    `insert into inventory_stock_state (id, paused, updated_at) values (1, $1, now())
     on conflict (id) do update set paused=excluded.paused, updated_at=now()`,
    [!!paused],
  );
  log(paused ? 'cola PAUSADA' : 'cola REANUDADA');
  return { paused: !!paused };
}

export async function getConfig(db) {
  const client = await target(db);
  const [inventory, paused, statsRows, reconciliationRows] = await Promise.all([
    catalogInventoryFlagState(db),
    getPaused(db),
    client.query('select status, count(*)::int as n from inventory_stock_jobs group by status'),
    client.query(`select last_reconciled_at, last_reconciliation, last_reconciliation_error
                    from inventory_stock_state where id=1`),
  ]);
  const stats = Object.fromEntries(statsRows.rows.map((row) => [row.status, row.n]));
  const reconciliation = reconciliationRows.rows[0] || {};
  return {
    inventoryEnabled: inventory.effective === true,
    inventoryLabel: inventory.label,
    inventorySourceLabel: inventory.sourceLabel,
    inventoryKillSwitch: inventory.killSwitch === true,
    paused,
    stats,
    workerIntervalSeconds: WORKER_INTERVAL_MS / 1000,
    reconciliationIntervalSeconds: RECONCILIATION_INTERVAL_MS / 1000,
    lastReconciledAt: reconciliation.last_reconciled_at || null,
    lastReconciliation: reconciliation.last_reconciliation || {},
    lastReconciliationError: reconciliation.last_reconciliation_error || null,
    batchSize: DEFAULT_LIMIT,
  };
}

export async function recentJobs(limit = 60, db) {
  const client = await target(db);
  const result = await client.query(
    `select j.id, j.company_id,
            coalesce(nullif(c.nombre_comercial, ''), nullif(c.nombre, ''), c.razon_social) as company,
            coalesce(nullif(j.order_number, ''), order_row.external_order_number) as order_number,
            j.external_order_id as order_id, j.status, j.source, j.attempts, j.result, j.last_error,
            j.created_at, j.updated_at,
            coalesce(item_summary.items, '[]'::jsonb) as items,
            coalesce(item_summary.reserved_units, 0) as reserved_units,
            coalesce(item_summary.applied_units, 0) as applied_units,
            coalesce(item_summary.unmatched_items, 0)::int as unmatched_items,
            coalesce(item_summary.insufficient_items, 0)::int as insufficient_items
     from inventory_stock_jobs j
     left join companies c on c.id=j.company_id
     left join lateral (
       select id, external_order_number
       from orders
       where id=j.order_id
          or (
            j.order_id is null
            and company_id=j.company_id
            and external_order_id=j.external_order_id
          )
       order by (id=j.order_id) desc, id asc
       limit 1
     ) order_row on true
     left join lateral (
       select jsonb_agg(jsonb_build_object(
                'id', oi.id,
                'title', coalesce(nullif(product.name, ''), nullif(oi.description, ''), 'Producto sin nombre'),
                'sellerSku', coalesce(oi.sku, ''),
                'quantity', oi.quantity,
                'mainSku', coalesce(nullif(oi.main_sku, ''), nullif(product.main_sku, '')),
                'stockState', oi.stock_state
              ) order by oi.id) as items,
              coalesce(sum(oi.stock_applied_quantity)
                filter (where oi.stock_state='pending'), 0) as reserved_units,
              coalesce(sum(oi.stock_applied_quantity)
                filter (where oi.stock_state='applied'), 0) as applied_units,
              count(*) filter (where oi.product_id is null) as unmatched_items,
              count(*) filter (where oi.stock_state='skipped_insufficient') as insufficient_items
         from order_items oi
         left join products product on product.id=oi.product_id
        where oi.order_id=order_row.id
     ) item_summary on true
     order by j.updated_at desc
     limit $1`,
    [Math.min(Math.max(Number(limit) || 60, 1), 200)],
  );
  return result.rows;
}

export async function retryJob(id, db) {
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId <= 0) throw new Error('Job inválido');
  const client = await target(db);
  const result = await client.query(
    `update inventory_stock_jobs
     set status='pending', attempts=0, last_error=null, next_attempt_at=null, updated_at=now()
     where id=$1 and status in ('failed','skipped')
     returning id, company_id, order_number, status`,
    [jobId],
  );
  return result.rows[0] || null;
}

export async function jobOrderPreview(id, db) {
  const jobId = Number(id);
  if (!Number.isInteger(jobId) || jobId <= 0) return { error: 'Job inválido' };
  const client = await target(db);
  const jobResult = await client.query(
    `select j.*, coalesce(c.nombre, c.nombre_comercial, c.razon_social) as company
     from inventory_stock_jobs j
     left join companies c on c.id=j.company_id
     where j.id=$1`,
    [jobId],
  );
  const job = jobResult.rows[0];
  if (!job) return { error: 'Job no encontrado' };

  const orderResult = await client.query(
    `select o.id, o.external_order_number, o.order_status, o.fulfillment_status,
            o.items_status, o.total,
            o.ordered_at, o.promised_shipping_at,
            count(oi.id)::int as items_count,
            coalesce(sum(oi.stock_applied_quantity), 0)::int as stock_applied
     from orders o
     left join order_items oi on oi.order_id=o.id
     where o.id=coalesce($3::bigint, (
       select id from orders
       where company_id=$1 and external_order_id=$2
       order by id limit 1
     ))
     group by o.id
     limit 1`,
    [job.company_id, job.external_order_id, job.order_id],
  );
  const order = orderResult.rows[0];
  const items = order ? (await client.query(
    `select oi.id,
            oi.description,
            oi.sku as seller_sku,
            oi.provider_sku,
            oi.quantity,
            oi.product_id,
            coalesce(nullif(oi.main_sku, ''), nullif(product.main_sku, '')) as main_sku,
            nullif(product.name, '') as product_name,
            oi.stock_state
       from order_items oi
       left join products product on product.id=oi.product_id
      where oi.order_id=$1
      order by oi.id`,
    [order.id],
  )).rows : [];
  const result = job.result || {};
  return {
    source: job.source,
    order: order ? {
      orderNumber: order.external_order_number || job.order_number,
      status: [order.order_status, order.fulfillment_status].filter(Boolean).join(' · '),
      itemsStatus: order.items_status,
      total: order.total,
      itemsCount: order.items_count,
      stockApplied: order.stock_applied,
      orderedAt: order.ordered_at,
      promisedShippingAt: order.promised_shipping_at,
    } : {
      orderNumber: job.order_number,
      status: 'Pedido no sincronizado todavía',
    },
    stock: {
      applied: result.applied ?? null,
      skipped: result.skipped ?? null,
      missing: result.missing ?? false,
    },
    items: items.map((item) => ({
      id: Number(item.id),
      title: item.product_name || item.description || 'Producto sin nombre',
      description: item.description || '',
      sellerSku: item.seller_sku || '',
      providerSku: item.provider_sku || null,
      quantity: Number(item.quantity || 0),
      productId: item.product_id == null ? null : Number(item.product_id),
      mainSku: item.main_sku || null,
      stockState: item.stock_state,
    })),
    company: job.company,
  };
}

async function enqueueCanonicalStockJob(orderId, source, client) {
  return client.query(
    `with canonical_order as (
       select id, company_id, external_order_id, external_order_number
       from orders where id=$1
     ), legacy as materialized (
       select job.*
       from inventory_stock_jobs job
       join canonical_order order_row
         on job.order_id is null
        and job.company_id=order_row.company_id
        and job.external_order_id=order_row.external_order_id
     ), promoted as (
       update inventory_stock_jobs job
          set order_id=order_row.id,
              company_id=order_row.company_id,
              external_order_id=order_row.external_order_id,
              order_number=order_row.external_order_number,
              status=case when job.status in ('failed','skipped') then 'pending' else job.status end,
              next_attempt_at=case when job.status in ('failed','skipped') then null else job.next_attempt_at end,
              updated_at=now()
         from canonical_order order_row
        where job.order_id is null
          and job.company_id=order_row.company_id
          and job.external_order_id=order_row.external_order_id
          and not exists (
            select 1 from inventory_stock_jobs existing where existing.order_id=order_row.id
          )
       returning job.*
     ), upserted as (
       insert into inventory_stock_jobs (
         order_id, company_id, external_order_id, order_number, status, source, created_at, updated_at
       )
       select order_row.id, order_row.company_id, order_row.external_order_id,
         order_row.external_order_number,
         case when exists (select 1 from legacy where status='done') then 'done' else 'pending' end,
         $2, now(), now()
       from canonical_order order_row
       where not exists (select 1 from promoted)
       on conflict (order_id) where order_id is not null do update set
         order_number=excluded.order_number,
         status=case
           when exists (select 1 from legacy where status='done') then 'done'
           when inventory_stock_jobs.status='processing' then 'processing'
           when inventory_stock_jobs.status in ('failed','skipped') then 'pending'
           else inventory_stock_jobs.status
         end,
         next_attempt_at=case
           when exists (select 1 from legacy where status='done') then null
           when inventory_stock_jobs.status in ('failed','skipped') then null
           else inventory_stock_jobs.next_attempt_at
         end,
         updated_at=now()
       returning inventory_stock_jobs.*
     ), survivor as (
       select * from promoted
       union all
       select * from upserted
     ), superseded as (
       update inventory_stock_jobs job
          set status=case
                when job.status in ('pending','processing','failed') then 'skipped'
                else job.status
              end,
              last_error=null,
              next_attempt_at=null,
              result=coalesce(job.result, '{}'::jsonb) || jsonb_build_object(
                'supersededByOrderId', survivor.order_id,
                'supersededAt', now()
              ),
              updated_at=now()
         from survivor
        where job.order_id is null
          and job.company_id=survivor.company_id
          and job.external_order_id=survivor.external_order_id
          and job.id<>survivor.id
          and (
            job.status in ('pending','processing','failed')
            or job.result->>'supersededByOrderId' is distinct from survivor.order_id::text
          )
       returning job.id
     )
     select survivor.*
     from survivor
     left join (select count(*) from superseded) completed on true
     limit 1`,
    [orderId, source],
  );
}

async function enqueueLegacyStockJob(input, client) {
  return client.query(
    `insert into inventory_stock_jobs (
       company_id, external_order_id, order_number, status, source, created_at, updated_at
     ) values ($1,$2,$3,'pending',$4,now(),now())
     on conflict (company_id, external_order_id) where order_id is null do update set
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
    [input.companyId, input.externalOrderId, input.orderNumber, input.source],
  );
}

export async function enqueueStockJob(input = {}, db) {
  let orderId = input.orderId == null ? null : Number(input.orderId);
  const companyId = Number(input.companyId);
  const externalOrderId = text(input.externalOrderId);
  if (
    (orderId != null && (!Number.isInteger(orderId) || orderId <= 0))
    || (!orderId && (!Number.isInteger(companyId) || companyId <= 0 || !externalOrderId))
  ) {
    return { enqueued: false, ignored: 'pedido inválido' };
  }
  const source = text(input.source, 50) || 'system';
  let identity = orderId ? (await (await target(db)).query(
    `select id, company_id, external_order_id, external_order_number
     from orders where id=$1`,
    [orderId],
  )).rows[0] : { company_id: companyId, external_order_id: externalOrderId };
  if (!identity) return { enqueued: false, ignored: 'pedido inexistente' };
  const result = await withIdentityLock(
    db,
    Number(identity.company_id),
    identity.external_order_id,
    async (client) => {
      if (orderId) {
        identity = (await client.query(
          `select id, company_id, external_order_id, external_order_number
           from orders where id=$1`,
          [orderId],
        )).rows[0];
        if (!identity) return { rows: [] };
      } else {
        const matches = await client.query(
          `select id, company_id, external_order_id, external_order_number
           from orders
           where company_id=$1 and external_order_id=$2
           order by id limit 2`,
          [companyId, externalOrderId],
        );
        if (matches.rows.length === 1) {
          [identity] = matches.rows;
          orderId = Number(identity.id);
        }
      }
      const enqueued = orderId
        ? await enqueueCanonicalStockJob(orderId, source, client)
        : await enqueueLegacyStockJob({
          companyId,
          externalOrderId,
          orderNumber: text(input.orderNumber) || null,
          source,
        }, client);
      if (orderId) {
        await client.query(
          `update inventory_stock_jobs job
              set status='pending', next_attempt_at=null, updated_at=now()
            from orders o
           where job.order_id=$1
             and o.id=$1
             and job.status='done'
             and o.fulfillment_status in ('pending','preparing','ready_to_ship','shipped','delivered')
             and exists (
               select 1 from order_items oi
               where oi.order_id=o.id
                 and oi.stock_state in ('none','pending','skipped_policy','skipped_unmapped','skipped_insufficient')
             )`,
          [orderId],
        );
      }
      return enqueued;
    },
  );
  const job = result.rows[0];
  if (!job) return { enqueued: false, ignored: 'pedido inexistente' };
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
    orderId: row.order_id == null ? null : Number(row.order_id),
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
  if (await getPaused(db)) return { claimed: 0, done: 0, failed: 0, retried: 0, applied: 0, skipped: 0, paused: true };
  if (!(await isCatalogInventoryEnabled(db))) {
    return { claimed: 0, done: 0, failed: 0, retried: 0, applied: 0, skipped: 0, inventoryDisabled: true };
  }
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
       select candidate.id from inventory_stock_jobs candidate
       where candidate.status='pending'
         and (candidate.next_attempt_at is null or candidate.next_attempt_at <= now())
         and (
           candidate.order_id is not null
           or not exists (
             select 1
             from orders order_row
             join inventory_stock_jobs canonical on canonical.order_id=order_row.id
             where order_row.company_id=candidate.company_id
               and order_row.external_order_id=candidate.external_order_id
               and (select count(*) from orders matched
                    where matched.company_id=candidate.company_id
                      and matched.external_order_id=candidate.external_order_id)=1
           )
         )
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
        orderId: job.orderId,
        companyId: job.companyId,
        externalOrderId: job.externalOrderId,
        source: job.source || 'webhook',
        // Un job representa una solicitud explícita de aplicar el stock. Esto
        // permite recuperar líneas hidratadas como históricas que ya estaban
        // listas cuando entraron a la cola, sin convertir los syncs de ventas
        // históricos en descuentos automáticos.
        includeSkippedPolicy: true,
      }, db);
      if (result?.missing || result?.itemsPending) {
        const next = await finishJob(client, job, 'pending', {
          retry: true,
          error: result?.itemsPending
            ? 'El pedido todavía no tiene sus artículos completos.'
            : 'Pedido canónico todavía no está disponible.',
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

export async function reopenReservedStockJobsForCommit(db) {
  const client = await target(db);
  const result = await client.query(
    `update inventory_stock_jobs job
        set status='pending', next_attempt_at=null, updated_at=now()
      from orders o
     where job.order_id=o.id
       and job.status='done'
       and o.fulfillment_status in ('ready_to_ship','shipped','delivered')
       and exists (
         select 1 from order_items oi
         where oi.order_id=o.id and oi.stock_state='pending'
       )
     returning job.id`,
  );
  return { reopened: result.rows.length };
}

export async function enqueueStockJobsSinceListenFrom(input = {}, db) {
  const since = input.since || INVENTORY_LISTEN_FROM_AT;
  const client = await target(db);
  const orders = await client.query(
    `select o.id as order_id, o.company_id, o.external_order_id, o.external_order_number
     from orders o
     where o.order_status not in ('cancelled','failed')
       and o.fulfillment_status in ('pending','preparing','ready_to_ship','shipped','delivered')
       and o.items_status='complete'
       and o.ordered_at >= $1::timestamptz
       and exists (
         select 1 from order_items oi
         where oi.order_id=o.id
           and oi.stock_state in ('none','skipped_policy','skipped_unmapped','skipped_insufficient')
       )
     order by o.id
     limit 50`,
    [since],
  );
  if (input.dryRun === true) {
    return { since, dryRun: true, orders: orders.rows.length, enqueued: 0, already: 0 };
  }
  let enqueued = 0;
  let already = 0;
  for (const row of orders.rows) {
    const result = await enqueueStockJob({
      orderId: row.order_id,
      companyId: row.company_id,
      externalOrderId: row.external_order_id,
      orderNumber: row.external_order_number,
      source: input.source || 'listen',
    }, db);
    if (result.enqueued) enqueued += 1;
    else already += 1;
  }
  return { since, orders: orders.rows.length, enqueued, already };
}

export async function enqueueStockJobsForOperationalDate(input = {}, db) {
  const date = limaDate(input.date || limaOffset(-1));
  const client = await target(db);
  const orders = await client.query(
    `select o.id as order_id, o.company_id, o.external_order_id, o.external_order_number
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
      orderId: row.order_id,
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

export async function runStockReconciliation(input = {}, db, dependencies = {}) {
  const paused = await (dependencies.getPaused || getPaused)(db);
  if (paused) return { paused: true, listened: null, reopened: null };
  const record = dependencies.record || (async (result, error) => {
    const client = await target(db);
    await client.query(
      `update inventory_stock_state
          set last_reconciled_at=now(),
              last_reconciliation=$1::jsonb,
              last_reconciliation_error=$2,
              updated_at=now()
        where id=1`,
      [JSON.stringify(result || {}), error || null],
    );
  });
  try {
    const listened = await (dependencies.enqueueSince || enqueueStockJobsSinceListenFrom)(
      { source: input.source || 'cron' },
      db,
    );
    const reopened = await (dependencies.reopen || reopenReservedStockJobsForCommit)(db);
    const result = { paused: false, listened, reopened };
    await record(result, null);
    return result;
  } catch (error) {
    await record(null, String(error?.message || error).slice(0, 2000)).catch(() => {});
    throw error;
  }
}

export function startStockReconciliationCron() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runStockReconciliation();
      if (result.listened?.enqueued || result.reopened?.reopened) log(JSON.stringify({ cron: result }));
    } catch (error) {
      log('cron error:', error?.message || error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { tick().catch(() => {}); }, RECONCILIATION_INTERVAL_MS);
  timer.unref?.();
  setTimeout(() => { tick().catch(() => {}); }, 3_000).unref?.();
  log(`conciliación cron cada ${RECONCILIATION_INTERVAL_MS / 1000}s.`);
  return timer;
}

export function startStockJobWorker() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      if (await getPaused()) return;
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
