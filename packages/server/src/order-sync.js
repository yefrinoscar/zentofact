import { RipleyApiClient } from '@zentofact/ripley-api';
import { operationalErrorBody } from './error-log.js';
import { syncFalabellaOrders } from './falabella-sync.js';
import { ingestRipleyOrder, withRipleyOrderLines } from './order-adapters/ripley.js';
import { resolveIncrementalOrderWindow, resolveOrderBackfillWindow } from './order-sync-policy.js';
import { providerFetch } from './provider-request.js';
import { ripleyApiUrl } from './ripley-api-url.js';
import { isFalabellaSyncEnabled } from './system-config.js';

const PAGE_SIZE = 100;
const MAX_PAGES = 1000;
const LOCK_NAMESPACE = 0x4f524452; // ORDR
const DEFAULT_CONCURRENCY = 3;
let corePromise;

function loadCore() {
  corePromise ||= import('@zentofact/core');
  return corePromise;
}

function positiveId(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${field} inválido.`);
  return parsed;
}

function accountRow(row) {
  if (!row) return null;
  return {
    channelAccountId: Number(row.channel_account_id ?? row.id),
    companyId: Number(row.company_id),
    channelCode: row.channel_code,
    displayName: row.display_name,
    externalAccountId: row.external_account_id,
    enabled: row.auto_create_orders === true,
    active: row.active === true,
    companyActive: row.company_active === true,
    falabellaApiUserId: row.falabella_api_user_id,
    falabellaApiKey: row.falabella_api_key,
    ripleyApiKey: row.ripley_api_key,
    ripleyShopId: row.ripley_shop_id,
    nombre: row.nombre,
    nombreComercial: row.nombre_comercial,
    razonSocial: row.razon_social,
  };
}

function hasCredentials(account) {
  if (account.channelCode === 'falabella') {
    return Boolean(account.falabellaApiUserId?.trim() && account.falabellaApiKey?.trim());
  }
  if (account.channelCode === 'ripley') return Boolean(account.ripleyApiKey?.trim());
  return false;
}

function assertEligible(account) {
  if (!account || !account.active || !account.companyActive) {
    throw new Error('Seller o cuenta de canal inactiva.');
  }
  if (!account.enabled) throw new Error('La sincronización de pedidos está desactivada para este seller.');
  if (!hasCredentials(account)) throw new Error(`Faltan credenciales de ${account.channelCode || 'canal'}.`);
}

async function loadAccount(db, accountId) {
  const result = await db.query(
    `select a.id as channel_account_id, a.company_id, a.external_account_id,
       a.display_name, a.auto_create_orders, a.active,
       ch.code as channel_code,
       c.activo as company_active, c.nombre, c.nombre_comercial, c.razon_social,
       c.falabella_api_user_id, c.falabella_api_key, c.ripley_api_key, c.ripley_shop_id
     from order_channel_accounts a
     join order_channels ch on ch.id=a.channel_id
     join companies c on c.id=a.company_id
     where a.id=$1`,
    [accountId],
  );
  return accountRow(result.rows[0]);
}

async function ensureState(db, accountId) {
  await db.query(
    `insert into order_sync_state (channel_account_id)
     values ($1) on conflict (channel_account_id) do nothing`,
    [accountId],
  );
  return (await db.query(
    'select * from order_sync_state where channel_account_id=$1',
    [accountId],
  )).rows[0];
}

function mapSyncStatus(row) {
  return {
    channelAccountId: Number(row.channel_account_id),
    companyId: Number(row.company_id),
    channelCode: row.channel_code,
    displayName: row.display_name,
    enabled: row.auto_create_orders === true,
    status: row.status || 'pending',
    dataUpdatedThrough: row.cursor_updated_at || null,
    lastAttemptAt: row.last_attempt_at || null,
    lastStartedAt: row.last_started_at || null,
    lastFinishedAt: row.last_finished_at || null,
    lastSuccessfulSyncAt: row.last_successful_sync_at || null,
    lastError: row.last_error || null,
    pagesProcessed: Number(row.last_pages_processed || 0),
    ordersReceived: Number(row.last_orders_received || 0),
    ordersUpserted: Number(row.last_orders_upserted || 0),
    ordersFailed: Number(row.last_orders_failed || 0),
    syncIntervalMinutes: Number(row.sync_interval_minutes || 15),
    lastRunId: row.last_run_id == null ? null : Number(row.last_run_id),
    lastLogId: row.last_log_id || null,
  };
}

export async function listOrderSyncStatuses(filters = {}, db) {
  const target = db || (await loadCore()).pool;
  const values = [];
  const where = [
    'c.activo=true',
    'a.active=true',
    "ch.code in ('falabella','ripley')",
    `case ch.code
      when 'falabella' then nullif(trim(c.falabella_api_user_id), '') is not null
        and nullif(trim(c.falabella_api_key), '') is not null
      when 'ripley' then nullif(trim(c.ripley_api_key), '') is not null
      else false end`,
  ];
  const companyId = positiveId(filters.companyId, 'companyId');
  const channelAccountId = positiveId(filters.channelAccountId, 'channelAccountId');
  if (companyId) {
    values.push(companyId);
    where.push(`a.company_id=$${values.length}`);
  }
  if (channelAccountId) {
    values.push(channelAccountId);
    where.push(`a.id=$${values.length}`);
  }
  const result = await target.query(
    `select a.id as channel_account_id, a.company_id, a.display_name, a.auto_create_orders,
       ch.code as channel_code, state.status, state.cursor_updated_at,
       state.last_attempt_at, state.last_started_at, state.last_finished_at,
       state.last_successful_sync_at, state.last_error, state.last_log_id,
       state.last_run_id, state.last_pages_processed, state.last_orders_received,
       state.last_orders_upserted, state.last_orders_failed, state.sync_interval_minutes
     from order_channel_accounts a
     join order_channels ch on ch.id=a.channel_id
     join companies c on c.id=a.company_id
     left join order_sync_state state on state.channel_account_id=a.id
     where ${where.join(' and ')}
     order by a.company_id, ch.name, a.display_name, a.id`,
    values,
  );
  return { accounts: result.rows.map(mapSyncStatus) };
}

function ripleyClient(account, dependencies) {
  if (dependencies.ripleyClient) return dependencies.ripleyClient;
  return new RipleyApiClient({
    baseUrl: dependencies.ripleyApiUrl || ripleyApiUrl(),
    apiKey: account.ripleyApiKey,
    shopId: account.ripleyShopId || undefined,
    fetchImpl: dependencies.ripleyFetch || providerFetch(fetch, dependencies.requestTimeoutMs),
  });
}

export async function recoverInterruptedOrderSyncRuns(accountIdInput, db) {
  const accountId = positiveId(accountIdInput, 'channelAccountId');
  const target = db || (await loadCore()).pool;
  const runs = await target.query(
    `update order_sync_runs set status='error', finished_at=now(),
       error=coalesce(error, 'La sincronización anterior se interrumpió antes de finalizar.')
     where channel_account_id=$1 and status='running'`,
    [accountId],
  );
  await target.query(
    `update order_sync_state set status='error', last_finished_at=now(),
       last_error=coalesce(last_error, 'La sincronización anterior se interrumpió antes de finalizar.'),
       updated_at=now()
     where channel_account_id=$1 and status='running'`,
    [accountId],
  );
  return { recovered: Number(runs.rowCount ?? runs.rows?.length ?? 0) };
}

export async function syncRipleyPages(db, account, window, runId, dependencies = {}) {
  const client = ripleyClient(account, dependencies);
  let pages = 0;
  let received = 0;
  let upserted = 0;
  let failed = 0;
  let lastLogId = null;
  let completed = false;
  for (let offset = 0; pages < MAX_PAGES; offset += PAGE_SIZE) {
    const page = await client.listOrders({
      max: PAGE_SIZE,
      offset,
      startUpdateDate: window.from,
      endUpdateDate: window.to,
    });
    pages += 1;
    received += page.orders.length;
    const orders = window.initial || window.creationRange
      ? page.orders.filter((order) => {
        const createdAt = new Date(order.createdAt || '');
        return !Number.isNaN(createdAt.getTime())
          && createdAt >= new Date(window.from)
          && createdAt <= new Date(window.to);
      })
      : page.orders;
    for (const listed of orders) {
      try {
        await db.query('begin');
        const normalized = await withRipleyOrderLines(client, listed);
        const result = await (dependencies.ingestRipleyOrder || ingestRipleyOrder)({
          companyId: account.companyId,
          company: { ...account, id: account.companyId },
          account: {
            id: account.channelAccountId,
            companyId: account.companyId,
            channelCode: account.channelCode,
            displayName: account.displayName,
          },
          normalized,
          correlationId: `order-sync:${runId}`,
          eventId: `ripley:${normalized.orderId}:${normalized.updatedAt || normalized.createdAt || 'observed'}`,
          source: 'sync',
        }, db);
        await db.query('commit');
        if (!result.skipped) upserted += 1;
        if (result.itemsPending) {
          failed += 1;
          const logged = operationalErrorBody(
            new Error(result.itemsError || 'Ripley no devolvió los items del pedido.'),
            {
              operation: 'order_sync_items',
              context: {
                seller: account.displayName,
                companyId: account.companyId,
                channelAccountId: account.channelAccountId,
                channelCode: account.channelCode,
                runId,
                externalOrderId: normalized.orderId,
              },
            },
          );
          lastLogId = logged.logId;
        }
      } catch (error) {
        await db.query('rollback').catch(() => {});
        failed += 1;
        const logged = operationalErrorBody(error, {
          operation: 'order_sync_order',
          context: {
            seller: account.displayName,
            companyId: account.companyId,
            channelAccountId: account.channelAccountId,
            channelCode: account.channelCode,
            runId,
            externalOrderId: listed.orderId,
          },
        });
        lastLogId = logged.logId;
      }
    }
    const exhaustedByTotal = page.totalCount != null && offset + page.max >= page.totalCount;
    if (exhaustedByTotal || page.orders.length < PAGE_SIZE) {
      completed = true;
      break;
    }
  }
  if (!completed) throw new Error('La sincronización de Ripley excedió el límite seguro de páginas.');
  return { pages, received, upserted, failed, lastLogId };
}

async function dispatchAccountSync(db, account, window, runId, dependencies) {
  if (account.channelCode === 'ripley') {
    return syncRipleyPages(db, account, window, runId, dependencies);
  }
  if (account.channelCode === 'falabella') {
    const result = await (dependencies.syncFalabellaOrders || syncFalabellaOrders)(account.companyId, {
      mode: window.initial || window.creationRange ? 'range_created' : 'range',
      from: window.from,
      to: window.to,
    });
    return {
      pages: Number(result.pages || 0),
      received: Number(result.received || 0),
      upserted: Number(result.upserted || 0),
      failed: Number(result.failed || 0),
      lastLogId: result.lastLogId || null,
    };
  }
  throw new Error(`El canal ${account.channelCode} no admite sincronización de pedidos.`);
}

export async function syncOrderAccount(accountIdInput, options = {}, dependencies = {}) {
  const accountId = positiveId(accountIdInput, 'channelAccountId');
  const core = dependencies.pool ? null : await loadCore();
  const pool = dependencies.pool || core.pool;
  const db = await pool.connect();
  let locked = false;
  let runId = null;
  let account = null;
  try {
    const lock = await db.query('select pg_try_advisory_lock($1,$2) as locked', [LOCK_NAMESPACE, accountId]);
    locked = lock.rows[0]?.locked === true;
    if (!locked) return { channelAccountId: accountId, status: 'already_running' };
    account = await loadAccount(db, accountId);
    assertEligible(account);
    const state = await ensureState(db, accountId);
    await recoverInterruptedOrderSyncRuns(accountId, db);
    const mode = options.mode === 'backfill' ? 'backfill' : 'incremental';
    const window = mode === 'backfill'
      ? resolveOrderBackfillWindow(options)
      : resolveIncrementalOrderWindow({ cursor: state.cursor_updated_at, now: options.now });
    window.initial = mode === 'incremental' && !state.cursor_updated_at;
    window.creationRange = mode === 'backfill';
    if (new Date(window.from) >= new Date(window.to)) {
      return { ...account, status: 'success', skipped: 'already_current' };
    }
    const run = await db.query(
      `insert into order_sync_runs (channel_account_id, mode, status, cursor_from, cursor_to)
       values ($1,$2,'running',$3,$4) returning id`,
      [accountId, mode, window.from, window.to],
    );
    runId = Number(run.rows[0].id);
    await db.query(
      `update order_sync_state set status='running', last_attempt_at=now(), last_started_at=now(),
       last_error=null, last_log_id=null, last_run_id=$2, updated_at=now()
       where channel_account_id=$1`,
      [accountId, runId],
    );
    const stats = await dispatchAccountSync(db, account, window, runId, dependencies);
    const status = stats.failed > 0 ? 'partial' : 'success';
    await db.query(
      `update order_sync_runs set status=$2, pages_count=$3, received_count=$4,
       upserted_count=$5, failed_count=$6, log_id=$7, finished_at=now() where id=$1`,
      [runId, status, stats.pages, stats.received, stats.upserted, stats.failed, stats.lastLogId],
    );
    await db.query(
      `update order_sync_state set status=$2, last_finished_at=now(),
       last_successful_sync_at=case when $2='success' then now() else last_successful_sync_at end,
       cursor_updated_at=case when $2='success' and $3='incremental' then $4::timestamptz else cursor_updated_at end,
       last_error=case when $2='partial' then $5 else null end,
       last_log_id=$6, last_pages_processed=$7, last_orders_received=$8,
       last_orders_upserted=$9, last_orders_failed=$10, updated_at=now()
       where channel_account_id=$1`,
      [
        accountId, status, mode, window.to,
        status === 'partial' ? `${stats.failed} pedido(s) fallaron; se reintentará la ventana.` : null,
        stats.lastLogId, stats.pages, stats.received, stats.upserted, stats.failed,
      ],
    );
    return {
      channelAccountId: accountId,
      companyId: account.companyId,
      channelCode: account.channelCode,
      status,
      runId,
      logId: stats.lastLogId,
      pages: stats.pages,
      received: stats.received,
      upserted: stats.upserted,
      failed: stats.failed,
    };
  } catch (error) {
    const logged = operationalErrorBody(error, {
      operation: 'order_sync_account',
      context: {
        seller: account?.displayName,
        companyId: account?.companyId,
        channelAccountId: accountId,
        channelCode: account?.channelCode,
        runId,
      },
    });
    if (runId) {
      await db.query(
        `update order_sync_runs set status='error', error=$2, log_id=$3, finished_at=now() where id=$1`,
        [runId, logged.error, logged.logId],
      ).catch(() => {});
    }
    await db.query(
      `update order_sync_state set status='error', last_finished_at=now(), last_error=$2,
       last_log_id=$3, last_run_id=coalesce($4,last_run_id), updated_at=now()
       where channel_account_id=$1`,
      [accountId, logged.error, logged.logId, runId],
    ).catch(() => {});
    return {
      channelAccountId: accountId,
      companyId: account?.companyId,
      channelCode: account?.channelCode,
      status: 'error',
      runId,
      logId: logged.logId,
      error: logged.error,
    };
  } finally {
    if (locked) await db.query('select pg_advisory_unlock($1,$2)', [LOCK_NAMESPACE, accountId]).catch(() => {});
    db.release();
  }
}

async function eligibleAccountIds(filters = {}, db) {
  const target = db || (await loadCore()).pool;
  const values = [];
  const where = [
    'c.activo=true',
    'a.active=true',
    'a.auto_create_orders=true',
    "ch.code in ('falabella','ripley')",
    `case ch.code
      when 'falabella' then nullif(trim(c.falabella_api_user_id), '') is not null
        and nullif(trim(c.falabella_api_key), '') is not null
      when 'ripley' then nullif(trim(c.ripley_api_key), '') is not null
      else false end`,
  ];
  for (const [field, column] of [['companyId', 'a.company_id'], ['channelAccountId', 'a.id']]) {
    const id = positiveId(filters[field], field);
    if (!id) continue;
    values.push(id);
    where.push(`${column}=$${values.length}`);
  }
  if (filters.due === true) {
    where.push(`(
      state.last_attempt_at is null
      or state.last_attempt_at <= now() - (coalesce(state.sync_interval_minutes, 15) * interval '1 minute')
    )`);
  }
  const result = await target.query(
    `select a.id
     from order_channel_accounts a
     join order_channels ch on ch.id=a.channel_id
     join companies c on c.id=a.company_id
     left join order_sync_state state on state.channel_account_id=a.id
     where ${where.join(' and ')}
     order by coalesce(state.last_attempt_at, '-infinity'::timestamptz), a.id`,
    values,
  );
  return result.rows.map((row) => Number(row.id));
}

async function mapBounded(values, limit, mapper) {
  const output = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(values[index]);
    }
  });
  await Promise.all(workers);
  return output;
}

export async function syncOrders(options = {}, dependencies = {}) {
  const ids = await eligibleAccountIds(options, dependencies.db);
  const concurrency = Math.min(Math.max(Number(dependencies.concurrency || DEFAULT_CONCURRENCY), 1), 10);
  const results = await mapBounded(ids, concurrency, (id) => syncOrderAccount(id, options, dependencies));
  return { results };
}

export function startOrderSyncScheduler(dependencies = {}) {
  let running = false;
  const tick = async () => {
    // El flag vive en BD (panel superadmin); la env solo actúa como kill-switch.
    if (!(await isFalabellaSyncEnabled(dependencies.db))) return;
    if (running) return;
    running = true;
    try {
      await syncOrders({ mode: 'incremental', due: true }, dependencies);
    } finally {
      running = false;
    }
  };
  const initial = setTimeout(() => tick().catch((error) => console.error('[ORDER SYNC]', error)), 30_000);
  const interval = setInterval(() => tick().catch((error) => console.error('[ORDER SYNC]', error)), 60_000);
  initial.unref?.();
  interval.unref?.();
  return { tick, initial, interval };
}
