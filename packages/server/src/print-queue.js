import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const LABELS_PER_PAGE = 4;
export const MAX_BATCH_LABELS = 8;
export const FLUSH_AFTER_MS = 60 * 60 * 1000;
export const CLAIM_TTL_MS = 2 * 60 * 1000;
export const POLL_HINT_MS = 3_000;
export const EMPTY_WAIT_MS = 5_000;
export const DEFAULT_STATION_ID = 'default';

const OPEN_STATUSES = ['pending', 'claimed'];
const ALREADY_HANDLED = ['done', 'skipped_manual', 'skipped_printed'];
const PRINTABLE_CHANNELS = new Set(['manual', 'falabella']);

let corePromise;
function loadCore() {
  corePromise ||= import('@zentofact/core');
  return corePromise;
}

async function target(db) {
  return db || (await loadCore()).pool;
}

export function isAutoPrintable(input = {}) {
  const channel = String(input.channelCode || '').trim().toLowerCase();
  const status = String(input.fulfillmentStatus || '').trim().toLowerCase();
  if (!PRINTABLE_CHANNELS.has(channel)) return false;
  if (status === 'cancelled' || status === 'returned' || status === 'failed' || status === 'unmapped') return false;
  if (status === 'shipped' || status === 'delivered') return false;
  if (channel === 'manual') return status === 'pending' || status === 'preparing' || status === 'ready_to_ship';
  return status === 'ready_to_ship';
}

function jobTime(job) {
  const raw = job?.createdAt || job?.created_at;
  const parsed = raw instanceof Date ? raw.getTime() : Date.parse(String(raw || ''));
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function selectPrintBatch(jobs, input = {}) {
  const now = input.now instanceof Date ? input.now.getTime() : (Date.parse(input.now) || Date.now());
  const pageSize = Number.isInteger(Number(input.pageSize)) && Number(input.pageSize) > 0
    ? Number(input.pageSize)
    : LABELS_PER_PAGE;
  const maxBatch = Number.isInteger(Number(input.maxBatch)) && Number(input.maxBatch) > 0
    ? Number(input.maxBatch)
    : MAX_BATCH_LABELS;
  const flushAfterMs = Number.isInteger(Number(input.flushAfterMs)) && Number(input.flushAfterMs) >= 0
    ? Number(input.flushAfterMs)
    : FLUSH_AFTER_MS;
  const pending = (Array.isArray(jobs) ? jobs : []).filter((job) => String(job?.status || '') === 'pending');
  if (!pending.length) {
    return { kind: 'wait', reason: 'empty', orderIds: [], jobIds: [], waitMs: EMPTY_WAIT_MS, pages: 0, pendingCount: 0 };
  }

  const oldestAt = jobTime(pending[0]);
  const ageMs = Number.isFinite(oldestAt) ? Math.max(0, now - oldestAt) : 0;
  if (pending.length >= pageSize) {
    const chosen = pending.slice(0, maxBatch);
    return {
      kind: 'print',
      reason: 'page_full',
      orderIds: chosen.map((job) => Number(job.orderId || job.order_id)),
      jobIds: chosen.map((job) => Number(job.id)),
      waitMs: 0,
      pages: Math.ceil(chosen.length / pageSize),
      pendingCount: pending.length,
    };
  }
  if (ageMs >= flushAfterMs) {
    return {
      kind: 'print',
      reason: 'hourly_flush',
      orderIds: pending.map((job) => Number(job.orderId || job.order_id)),
      jobIds: pending.map((job) => Number(job.id)),
      waitMs: 0,
      pages: Math.ceil(pending.length / pageSize),
      pendingCount: pending.length,
    };
  }
  return {
    kind: 'wait',
    reason: 'gathering',
    orderIds: [],
    jobIds: [],
    waitMs: POLL_HINT_MS,
    pages: 0,
    pendingCount: pending.length,
    flushAt: Number.isFinite(oldestAt) ? new Date(oldestAt + flushAfterMs).toISOString() : null,
  };
}

export function hashPrintToken(token) {
  return createHash('sha256').update(String(token || '')).digest('hex');
}

export function newPrintToken() {
  return `zfprint_${randomBytes(24).toString('hex')}`;
}

function hashesEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (!a.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function bearerToken(header) {
  const value = String(header || '').trim();
  const match = /^Bearer\s+(\S+)$/i.exec(value);
  return match ? match[1] : '';
}

export function envPrintToken(env = process.env) {
  return String(env.PRINT_STATION_TOKEN || env.ZENTOFACT_PRINT_TOKEN || '').trim();
}

function envFlag(name, env = process.env) {
  const value = String(env[name] ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

export async function ensurePrintQueueTables(db) {
  const client = await target(db);
  await client.query(`
    create table if not exists print_stations (
      id text primary key,
      enabled boolean not null default false,
      token_hash text,
      token_suffix text,
      last_seen_at timestamptz,
      last_batch_at timestamptz,
      last_error text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    insert into print_stations (id, enabled) values ('${DEFAULT_STATION_ID}', false)
      on conflict (id) do nothing;
    create table if not exists print_jobs (
      id bigserial primary key,
      order_id bigint not null references orders(id) on delete cascade,
      status text not null default 'pending',
      batch_id text,
      reason text,
      claimed_by text,
      claimed_at timestamptz,
      claim_expires_at timestamptz,
      printed_at timestamptz,
      error text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check (status in (
        'pending', 'claimed', 'done',
        'skipped_printed', 'skipped_manual', 'skipped_unprintable', 'failed'
      ))
    );
    create unique index if not exists idx_print_jobs_open_order
      on print_jobs (order_id) where status in ('pending', 'claimed');
    create index if not exists idx_print_jobs_pending_created
      on print_jobs (created_at, id) where status = 'pending';
    create index if not exists idx_print_jobs_batch
      on print_jobs (batch_id) where batch_id is not null;
  `);
}

const PRINTABLE_ORDER_SQL = `(
  (ch.code = 'manual' and o.fulfillment_status in ('pending', 'preparing', 'ready_to_ship'))
  or (ch.code = 'falabella' and o.fulfillment_status = 'ready_to_ship')
)`;

export async function syncPrintJobForOrder(db, input = {}) {
  const orderId = Number(input.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) return { ok: false };
  const client = await target(db);
  if (!isAutoPrintable(input)) {
    await skipOpenJobs(client, [orderId], 'skipped_unprintable');
    return { ok: true, enqueued: false, reason: 'unprintable' };
  }
  const printed = await client.query(
    'select print_count from logistics_label_prints where order_id = $1',
    [orderId],
  );
  if (Number(printed.rows[0]?.print_count || 0) > 0) {
    await skipOpenJobs(client, [orderId], 'skipped_printed');
    return { ok: true, enqueued: false, reason: 'already_printed' };
  }
  const inserted = await client.query(
    `insert into print_jobs (order_id, status)
     select $1, 'pending'
     where not exists (
       select 1 from print_jobs pj
       where pj.order_id = $1 and pj.status = any($2::text[])
     )
     returning id`,
    [orderId, OPEN_STATUSES],
  );
  return { ok: true, enqueued: inserted.rows.length > 0, jobId: inserted.rows[0]?.id || null };
}

export async function skipPrintJobsForManualPrint(db, orderIds) {
  return skipOpenJobs(db, orderIds, 'skipped_manual');
}

async function skipOpenJobs(db, orderIds, status) {
  const ids = [...new Set((Array.isArray(orderIds) ? orderIds : [])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0))];
  if (!ids.length) return 0;
  const client = await target(db);
  const result = await client.query(
    `update print_jobs
     set status = $2, updated_at = now(), claimed_by = null, claim_expires_at = null
     where order_id = any($1::bigint[])
       and status = any($3::text[])
     returning id`,
    [ids, status, OPEN_STATUSES],
  );
  return result.rows.length;
}

export async function enqueuePrintableOrders(db, limit = 200) {
  const client = await target(db);
  const cap = Number.isInteger(Number(limit)) ? Math.min(Math.max(Number(limit), 1), 500) : 200;
  const result = await client.query(
    `insert into print_jobs (order_id, status)
     select o.id, 'pending'
     from orders o
     join order_channel_accounts a on a.id = o.channel_account_id
     join order_channels ch on ch.id = a.channel_id
     where ${PRINTABLE_ORDER_SQL}
       and not exists (
         select 1 from logistics_label_prints lp
         where lp.order_id = o.id and lp.print_count > 0
       )
       and not exists (
         select 1 from print_jobs pj
         where pj.order_id = o.id and pj.status = any($1::text[])
       )
     order by coalesce(o.updated_at, o.created_at) asc, o.id asc
     limit $2
     returning id, order_id`,
    [[...OPEN_STATUSES, ...ALREADY_HANDLED], cap],
  );
  return result.rows;
}

export async function skipStalePrintJobs(db) {
  const client = await target(db);
  const printed = await client.query(
    `update print_jobs pj
     set status = 'skipped_printed', updated_at = now()
     from logistics_label_prints lp
     where lp.order_id = pj.order_id
       and lp.print_count > 0
       and pj.status = 'pending'
     returning pj.id`,
  );
  const unprintable = await client.query(
    `update print_jobs pj
     set status = 'skipped_unprintable', updated_at = now()
     from orders o
     join order_channel_accounts a on a.id = o.channel_account_id
     join order_channels ch on ch.id = a.channel_id
     where o.id = pj.order_id
       and pj.status = 'pending'
       and not ${PRINTABLE_ORDER_SQL}
     returning pj.id`,
  );
  return { printed: printed.rows.length, unprintable: unprintable.rows.length };
}

export async function releaseStaleClaims(db, now = new Date()) {
  const client = await target(db);
  const result = await client.query(
    `update print_jobs
     set status = 'pending',
         batch_id = null,
         claimed_by = null,
         claimed_at = null,
         claim_expires_at = null,
         updated_at = now()
     where status = 'claimed'
       and claim_expires_at is not null
       and claim_expires_at < $1
     returning id`,
    [now],
  );
  return result.rows.length;
}

async function loadPendingJobs(db) {
  const client = await target(db);
  const result = await client.query(
    `select pj.id, pj.order_id, pj.status, pj.created_at
     from print_jobs pj
     where pj.status = 'pending'
     order by pj.created_at asc, pj.id asc
     limit 80`,
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    orderId: Number(row.order_id),
    status: row.status,
    createdAt: row.created_at,
  }));
}

export async function claimNextBatch(input = {}, db) {
  const client = await target(db);
  const stationId = String(input.stationId || DEFAULT_STATION_ID);
  const now = input.now instanceof Date ? input.now : new Date();
  await touchStation(client, stationId, { lastError: null });
  const station = await readStation(client, stationId);
  if (!station.enabled) {
    return { kind: 'wait', reason: 'disabled', waitMs: EMPTY_WAIT_MS, pendingCount: 0, orderIds: [], jobIds: [] };
  }
  await releaseStaleClaims(client, now);
  await enqueuePrintableOrders(client);
  await skipStalePrintJobs(client);
  const pending = await loadPendingJobs(client);
  const decision = selectPrintBatch(pending, { now, pageSize: input.pageSize, maxBatch: input.maxBatch, flushAfterMs: input.flushAfterMs });
  if (decision.kind !== 'print' || !decision.jobIds.length) {
    return { ...decision, listening: true };
  }
  const batchId = randomBytes(16).toString('hex');
  const claimed = await client.query(
    `update print_jobs
     set status = 'claimed',
         batch_id = $2,
         reason = $3,
         claimed_by = $4,
         claimed_at = $5,
         claim_expires_at = $6,
         updated_at = now()
     where id = any($1::bigint[])
       and status = 'pending'
     returning id, order_id`,
    [
      decision.jobIds,
      batchId,
      decision.reason,
      stationId,
      now,
      new Date(now.getTime() + CLAIM_TTL_MS),
    ],
  );
  if (!claimed.rows.length) {
    return { kind: 'wait', reason: 'empty', waitMs: POLL_HINT_MS, pendingCount: pending.length, orderIds: [], jobIds: [], listening: true };
  }
  return {
    kind: 'print',
    reason: decision.reason,
    batchId,
    pages: Math.ceil(claimed.rows.length / LABELS_PER_PAGE),
    pendingCount: pending.length,
    orderIds: claimed.rows.map((row) => Number(row.order_id)),
    jobIds: claimed.rows.map((row) => Number(row.id)),
    listening: true,
  };
}

export async function ackPrintBatch(input = {}, db) {
  const client = await target(db);
  const batchId = String(input.batchId || '').trim();
  if (!batchId) throw new Error('Falta el lote de impresión.');
  const orderIds = [...new Set((Array.isArray(input.orderIds) ? input.orderIds : [])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0))];
  const claimed = await client.query(
    `select id, order_id, status
     from print_jobs
     where batch_id = $1`,
    [batchId],
  );
  const printable = claimed.rows.filter((row) => row.status === 'claimed'
    && (!orderIds.length || orderIds.includes(Number(row.order_id))));
  const skipped = claimed.rows.filter((row) => row.status !== 'claimed');
  if (printable.length) {
    const ids = printable.map((row) => Number(row.order_id));
    await client.query(
      `insert into logistics_label_prints (order_id, print_count, first_printed_at, last_printed_at, last_printed_by)
       select id, 1, now(), now(), $2 from unnest($1::bigint[]) as ids(id)
       on conflict (order_id) do update set
         print_count = logistics_label_prints.print_count + 1,
         last_printed_at = now(),
         last_printed_by = excluded.last_printed_by`,
      [ids, String(input.printedBy || 'print-agent').slice(0, 120)],
    );
    await client.query(
      `update print_jobs
       set status = 'done', printed_at = now(), updated_at = now(), error = null
       where id = any($1::bigint[]) and status = 'claimed'`,
      [printable.map((row) => Number(row.id))],
    );
  }
  await touchStation(client, input.stationId || DEFAULT_STATION_ID, { lastBatchAt: new Date(), lastError: '' });
  return {
    ok: true,
    printed: printable.map((row) => Number(row.order_id)),
    skipped: skipped.map((row) => ({ orderId: Number(row.order_id), status: row.status })),
  };
}

export async function releaseClaimedOrders(input = {}, db) {
  const client = await target(db);
  const batchId = String(input.batchId || '').trim();
  const ids = [...new Set((Array.isArray(input.orderIds) ? input.orderIds : [])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0))];
  if (!batchId || !ids.length) return 0;
  const result = await client.query(
    `update print_jobs
     set status = 'pending',
         batch_id = null,
         claimed_by = null,
         claimed_at = null,
         claim_expires_at = null,
         error = $3,
         updated_at = now()
     where batch_id = $1
       and order_id = any($2::bigint[])
       and status = 'claimed'
     returning id`,
    [batchId, ids, String(input.error || 'Etiqueta no disponible.').slice(0, 300)],
  );
  return result.rows.length;
}

export async function failPrintBatch(input = {}, db) {
  const client = await target(db);
  const batchId = String(input.batchId || '').trim();
  if (!batchId) throw new Error('Falta el lote de impresión.');
  const error = String(input.error || 'La impresora no pudo imprimir.').slice(0, 300);
  await client.query(
    `update print_jobs
     set status = 'pending',
         batch_id = null,
         claimed_by = null,
         claimed_at = null,
         claim_expires_at = null,
         error = $2,
         updated_at = now()
     where batch_id = $1 and status = 'claimed'`,
    [batchId, error],
  );
  await touchStation(client, input.stationId || DEFAULT_STATION_ID, { lastError: error });
  return { ok: true };
}

export async function releaseBatch(batchId, error, db) {
  return failPrintBatch({ batchId, error }, db);
}

async function readStation(db, stationId = DEFAULT_STATION_ID) {
  const client = await target(db);
  const result = await client.query('select * from print_stations where id = $1', [stationId]);
  const row = result.rows[0] || { id: stationId, enabled: false };
  const envToken = envPrintToken();
  return {
    id: String(row.id || stationId),
    enabled: row.enabled === true || envFlag('PRINT_STATION_ENABLED'),
    tokenHash: row.token_hash || null,
    tokenSuffix: row.token_suffix || null,
    lastSeenAt: row.last_seen_at || null,
    lastBatchAt: row.last_batch_at || null,
    lastError: row.last_error || null,
    envToken: Boolean(envToken),
  };
}

async function touchStation(db, stationId, patch = {}) {
  const client = await target(db);
  await client.query(
    `insert into print_stations (id, last_seen_at, last_batch_at, last_error, updated_at)
     values ($1, now(), $2, $3, now())
     on conflict (id) do update set
       last_seen_at = now(),
       last_batch_at = coalesce($2, print_stations.last_batch_at),
       last_error = coalesce($3, print_stations.last_error),
       updated_at = now()`,
    [stationId, patch.lastBatchAt || null, patch.lastError === undefined ? null : patch.lastError],
  );
}

export async function verifyStationToken(token, db, env = process.env) {
  const provided = String(token || '').trim();
  if (!provided) return null;
  const providedHash = hashPrintToken(provided);
  const envToken = envPrintToken(env);
  if (envToken && hashesEqual(providedHash, hashPrintToken(envToken))) {
    return { id: DEFAULT_STATION_ID, source: 'env' };
  }
  const station = await readStation(db, DEFAULT_STATION_ID);
  if (station.tokenHash && hashesEqual(providedHash, station.tokenHash)) {
    return { id: station.id, source: 'station' };
  }
  return null;
}

export async function getPrintStation(db) {
  const client = await target(db);
  await enqueuePrintableOrders(client).catch(() => []);
  await skipStalePrintJobs(client).catch(() => ({ printed: 0, unprintable: 0 }));
  const station = await readStation(client);
  const pending = await loadPendingJobs(client);
  const decision = selectPrintBatch(pending, { now: new Date() });
  const seenAt = station.lastSeenAt ? new Date(station.lastSeenAt).getTime() : 0;
  const listening = Boolean(seenAt) && Date.now() - seenAt < 30_000;
  return {
    enabled: station.enabled,
    hasToken: Boolean(station.tokenHash) || station.envToken,
    tokenSuffix: station.tokenSuffix,
    envToken: station.envToken,
    lastSeenAt: station.lastSeenAt,
    lastBatchAt: station.lastBatchAt,
    lastError: station.lastError,
    listening,
    pendingCount: pending.length,
    nextReason: decision.reason,
    flushAt: decision.flushAt || null,
    labelsPerPage: LABELS_PER_PAGE,
    maxBatch: MAX_BATCH_LABELS,
    flushAfterMinutes: Math.round(FLUSH_AFTER_MS / 60000),
  };
}

export async function setPrintStationEnabled(enabled, db) {
  const client = await target(db);
  await client.query(
    `insert into print_stations (id, enabled, updated_at)
     values ($1, $2, now())
     on conflict (id) do update set enabled = $2, updated_at = now()`,
    [DEFAULT_STATION_ID, enabled === true],
  );
  return getPrintStation(client);
}

export async function rotatePrintStationToken(db) {
  const client = await target(db);
  const token = newPrintToken();
  const suffix = token.slice(-4);
  await client.query(
    `insert into print_stations (id, token_hash, token_suffix, updated_at)
     values ($1, $2, $3, now())
     on conflict (id) do update set
       token_hash = $2,
       token_suffix = $3,
       updated_at = now()`,
    [DEFAULT_STATION_ID, hashPrintToken(token), suffix],
  );
  const station = await getPrintStation(client);
  return { ...station, token };
}

export function attachPrintStation(loadDb = target) {
  return async (c, next) => {
    const token = bearerToken(c.req.header('authorization'));
    if (!token) return next();
    const db = await loadDb();
    const station = await verifyStationToken(token, db);
    if (!station) return c.json({ error: 'Estación de impresión no autorizada' }, 401);
    c.set('printStation', station);
    c.set('user', { email: 'print-agent', name: 'print-agent', role: 'print_station' });
    return next();
  };
}

export function startPrintQueueSweeper(db) {
  const tick = () => enqueuePrintableOrders(db).catch((error) => {
    console.error('[PRINT QUEUE]', error?.stack || error);
  });
  tick();
  const timer = setInterval(tick, 60_000);
  timer.unref?.();
  return timer;
}
