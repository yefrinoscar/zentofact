import { FalabellaApiClient, getFalabellaError, normalizeGetOrdersResult } from '@zentofact/falabella-api';
import { enqueueStockJob } from './catalog/stock-jobs.js';
import { shouldListenStockOrder } from './catalog/stock-commitment.js';
import { operationalErrorBody } from './error-log.js';
import { isFalabellaSyncEnabled } from './system-config.js';
import {
  ensureFalabellaOrderAccount,
  ingestFalabellaOrder,
} from './order-adapters/falabella.js';
import { providerFetch } from './provider-request.js';
import { resolveIncrementalOrderWindow } from './order-sync-policy.js';

const PAGE_SIZE = 100;
const MAX_PAGES = 1000;
const LOCK_NAMESPACE = 0x46414c41; // "FALA"
let corePromise;

function loadCore() {
  corePromise ||= import('@zentofact/core');
  return corePromise;
}

export function normalizeFalabellaStatus(statuses) {
  const visit = (value) => {
    if (value == null) return [];
    if (typeof value === 'string' || typeof value === 'number') return [String(value)];
    if (Array.isArray(value)) return value.flatMap(visit);
    if (typeof value === 'object') {
      if ('Status' in value) return visit(value.Status);
      if ('status' in value) return visit(value.status);
      if ('Name' in value) return visit(value.Name);
      if ('name' in value) return visit(value.name);
    }
    return [];
  };
  return visit(statuses).map((value) => value.trim()).filter(Boolean).join('|').toLowerCase();
}

export function effectiveFalabellaItemStatus(items) {
  const statuses = (Array.isArray(items) ? items : [])
    .map((item) => String(item?.Status ?? item?.status ?? '').trim().toLowerCase())
    .filter(Boolean);
  if (!statuses.length) return '';
  const has = (value) => statuses.some((status) => status === value || status.includes(value));
  if (has('pending')) return 'pending';
  if (has('ready_to_ship')) return 'ready_to_ship';
  if (has('shipped')) return 'shipped';
  if (has('delivered')) return 'delivered';
  if (has('canceled') || has('cancelled')) return 'canceled';
  if (has('returned') || has('return_')) return 'returned';
  if (has('failed')) return 'failed';
  return [...new Set(statuses)].join('|');
}

export function falabellaLabelCount(items) {
  const packageIds = (Array.isArray(items) ? items : [])
    .map((item) => String(
      item?.PackageId ?? item?.PackageID ?? item?.packageId ?? item?.packageID ?? '',
    ).trim())
    .filter(Boolean);
  return Math.max(1, new Set(packageIds).size);
}

export function normalizeFalabellaOrder(order) {
  const raw = order?.Order && typeof order.Order === 'object' ? order.Order : order;
  const orderNumber = String(raw?.OrderNumber || '').trim();
  const orderId = String(raw?.OrderId || orderNumber).trim();
  if (!orderNumber || !orderId) return null;
  const amount = Number(String(raw?.GrandTotal ?? raw?.Price ?? '').replace(/,/g, ''));
  const invoiceValue = raw?.InvoiceRequired;
  return {
    orderId,
    orderNumber,
    falabellaCreatedAt: validDate(raw?.CreatedAt),
    falabellaUpdatedAt: validDate(raw?.UpdatedAt),
    status: normalizeFalabellaStatus(raw?.Statuses),
    invoiceRequired: invoiceValue === true || invoiceValue === 1 || String(invoiceValue).toLowerCase() === 'true' || String(invoiceValue) === '1',
    grandTotal: Number.isFinite(amount) ? amount : null,
    currency: String(raw?.Currency || raw?.CurrencyCode || 'PEN').trim() || 'PEN',
    raw,
  };
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function canonicalLifecycleStatus(status) {
  const value = String(status || '').toLowerCase();
  if (value.includes('pending')) return 'pending';
  if (value.includes('ready_to_ship')) return 'ready_to_ship';
  if (value.includes('shipped')) return 'shipped';
  if (value.includes('delivered')) return 'delivered';
  if (value.includes('canceled') || value.includes('cancelled')) return 'canceled';
  if (value.includes('returned') || value.includes('return_')) return 'returned';
  if (value.includes('failed')) return 'failed';
  return value;
}

async function recordOrderLifecycle(db, input) {
  const currentStatus = canonicalLifecycleStatus(input.currentStatus);
  await db.query(
    `insert into falabella_order_lifecycle (
       company_id, order_id, order_number, current_status, pending_at,
       ready_to_ship_at, shipped_at, last_provider_update_at,
       first_observed_at, last_observed_at
     ) values ($1,$2,$3,$4,$5,null,null,$6,now(),now())
     on conflict (company_id, order_id) do update set
       order_number=excluded.order_number,
       pending_at=coalesce(falabella_order_lifecycle.pending_at, excluded.pending_at),
       ready_to_ship_at=coalesce(
         falabella_order_lifecycle.ready_to_ship_at,
         case when falabella_order_lifecycle.current_status='pending'
           and excluded.current_status='ready_to_ship'
           then coalesce(excluded.last_provider_update_at, now()) end
       ),
       shipped_at=coalesce(
         falabella_order_lifecycle.shipped_at,
         case when falabella_order_lifecycle.current_status in ('pending','ready_to_ship')
           and excluded.current_status='shipped'
           then coalesce(excluded.last_provider_update_at, now()) end
       ),
       current_status=excluded.current_status,
       last_provider_update_at=coalesce(excluded.last_provider_update_at, falabella_order_lifecycle.last_provider_update_at),
       last_observed_at=now()`,
    [input.companyId, input.orderId, input.orderNumber, currentStatus,
      validDate(input.pendingAt), validDate(input.providerUpdatedAt)],
  );
}

function monthWindow(month) {
  const match = String(month || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) throw new Error('Mes inválido; usa YYYY-MM.');
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) throw new Error('Mes inválido; usa YYYY-MM.');
  const nextYear = monthIndex === 11 ? year + 1 : year;
  const nextMonth = monthIndex === 11 ? 1 : monthIndex + 2;
  const startMonth = String(monthIndex + 1).padStart(2, '0');
  const endMonth = String(nextMonth).padStart(2, '0');
  return {
    from: new Date(`${year}-${startMonth}-01T00:00:00-05:00`),
    to: new Date(`${nextYear}-${endMonth}-01T00:00:00-05:00`),
  };
}

function limaDayWindow(date) {
  const value = String(date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Fecha inválida; usa YYYY-MM-DD.');
  const from = new Date(`${value}T05:00:00.000Z`);
  if (Number.isNaN(from.getTime())) throw new Error('Fecha inválida; usa YYYY-MM-DD.');
  return { from, to: new Date(from.getTime() + 86_400_000) };
}

function resolveSyncMode(options = {}) {
  if (options.mode === 'month') return 'month';
  if (options.mode === 'day' || options.date) return 'day';
  if (options.mode === 'range') return 'range';
  if (options.mode === 'range_created') return 'range_created';
  return 'incremental';
}

export function catalogInventoryEnabledForSync(mode, restockNow) {
  return mode === 'incremental' && restockNow === true;
}

export async function fetchFalabellaPages(client, filters, onPage, pageSize = PAGE_SIZE) {
  let pages = 0;
  let received = 0;
  let completed = false;
  for (let offset = 0; pages < MAX_PAGES; offset += pageSize) {
    const response = await client.getOrdersV2({ ...filters, limit: pageSize, offset });
    const apiError = getFalabellaError(response.data);
    if (apiError) {
      throw new Error(apiError.Head?.ErrorMessage || apiError.Head?.ErrorCode || 'Falabella devolvió un error.');
    }
    if (!response.ok) throw new Error(`Falabella respondió HTTP ${response.status}.`);
    const orders = normalizeGetOrdersResult(response.data).orders || [];
    pages += 1;
    received += orders.length;
    await onPage(orders, { page: pages, offset });
    if (orders.length < pageSize) {
      completed = true;
      break;
    }
  }
  if (!completed) throw new Error('La sincronización excedió el límite seguro de páginas.');
  return { pages, received };
}

async function upsertOrders(db, companyId, orders, context = {}) {
  let upserted = 0;
  let canonicalAccount = context.account || null;
  for (const order of orders) {
    try {
      const normalized = normalizeFalabellaOrder(order);
      if (!normalized) continue;
      const upsertResult = await db.query(
      `insert into falabella_orders (
         company_id, order_id, order_number, falabella_created_at, falabella_updated_at,
         status, invoice_required, grand_total, currency, raw_data,
         first_seen_at, last_seen_at, synchronized_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),now(),now())
       on conflict (company_id, order_id) do update set
         order_number=excluded.order_number,
         falabella_created_at=coalesce(excluded.falabella_created_at, falabella_orders.falabella_created_at),
         falabella_updated_at=coalesce(excluded.falabella_updated_at, falabella_orders.falabella_updated_at),
          status=case
            when lower(coalesce(falabella_orders.status, '')) ~ '(^|\\|)(ready_to_ship|shipped|delivered)(\\||$)'
              and lower(coalesce(excluded.status, '')) ~ '^pending(\\|pending)*$'
            then falabella_orders.status
            else excluded.status
          end,
         invoice_required=excluded.invoice_required,
         grand_total=excluded.grand_total,
         currency=excluded.currency,
         raw_data=case
           when lower(coalesce(falabella_orders.status, '')) ~ '(^|\\|)(ready_to_ship|shipped|delivered)(\\||$)'
             and lower(coalesce(excluded.status, '')) ~ '^pending(\\|pending)*$'
           then falabella_orders.raw_data
           else excluded.raw_data
         end,
         last_seen_at=now(), synchronized_at=now()
       returning status`,
      [companyId, normalized.orderId, normalized.orderNumber, normalized.falabellaCreatedAt,
        normalized.falabellaUpdatedAt, normalized.status, normalized.invoiceRequired,
        normalized.grandTotal, normalized.currency, JSON.stringify(normalized.raw)],
    );
      const lifecycleStatus = canonicalLifecycleStatus(upsertResult.rows[0]?.status || normalized.status);
      const restockNow = ['canceled', 'returned', 'failed'].includes(lifecycleStatus);
      await recordOrderLifecycle(db, {
      companyId,
      orderId: normalized.orderId,
      orderNumber: normalized.orderNumber,
      currentStatus: lifecycleStatus,
      pendingAt: normalized.falabellaCreatedAt,
      providerUpdatedAt: normalized.falabellaUpdatedAt,
    });
      if (context.canonical !== false) {
        canonicalAccount ||= await ensureFalabellaOrderAccount(db, companyId);
        const ingested = await ingestFalabellaOrder({
        companyId,
        normalized,
        account: canonicalAccount,
        source: context.source || 'sync',
        correlationId: context.correlationId,
        eventId: context.eventId,
        catalogInventoryEnabled: context.syncMode
          ? catalogInventoryEnabledForSync(context.syncMode, restockNow)
          : (restockNow ? true : (context.enqueueStock ? false : context.catalogInventoryEnabled)),
      }, db);
        if (context.enqueueStock && shouldListenStockOrder({
          status: lifecycleStatus,
          orderedAt: normalized.falabellaCreatedAt,
        })) {
          await enqueueStockJob({
          orderId: ingested.order.id,
          companyId,
          externalOrderId: normalized.orderId,
          orderNumber: normalized.orderNumber,
          source: context.source || 'sync',
          }, context.stockDb || db).catch((error) => {
            console.warn(JSON.stringify({
            event: 'catalog.stock.enqueue_failed',
            companyId,
            orderId: normalized.orderId,
            message: String(error?.message || error),
            }));
          });
        }
      }
      upserted += 1;
    } catch (error) {
      if (!context.failures) throw error;
      const logged = operationalErrorBody(error, {
        operation: 'order_sync_order',
        context: {
          seller: context.seller,
          companyId,
          channelAccountId: canonicalAccount?.id,
          channelCode: 'falabella',
          runId: context.runId,
          externalOrderId: order?.OrderId || order?.orderId,
        },
      });
      context.failures.count += 1;
      context.failures.lastLogId = logged.logId;
    }
  }
  return upserted;
}

async function ensureState(db, companyId) {
  await db.query(
    `insert into falabella_sync_state (company_id, initial_sync_from)
     values ($1, (current_date - interval '12 months')::date)
     on conflict (company_id) do nothing`,
    [companyId],
  );
  return (await db.query('select * from falabella_sync_state where company_id=$1', [companyId])).rows[0];
}

export function extractOrderItems(document) {
  const candidate = document?.SuccessResponse?.Body?.OrderItems?.OrderItem
    || document?.OrderItems?.OrderItem
    || document?.OrderItems
    || document?.data?.orderItems
    || document?.data?.OrderItems
    || document?.orderItems;
  if (Array.isArray(candidate)) return candidate;
  if (candidate && typeof candidate === 'object') return [candidate];
  return [];
}

async function markFalabellaItemsError(db, accountId, externalOrderId, message) {
  if (!accountId) return;
  await db.query(
    `update orders set items_status='error', items_error=$3, updated_at=now()
     where channel_account_id=$1 and external_order_id=$2 and items_status <> 'complete'`,
    [accountId, externalOrderId, String(message || 'No se pudieron sincronizar los items.').slice(0, 2000)],
  );
}

async function hydrateMissingOrderItems(db, companyId, client, options = {}) {
  if (typeof client?.call !== 'function') return { candidates: 0, checked: 0, hydrated: 0, failed: 0 };
  const limit = Math.min(Math.max(Number(options.limit || 100), 1), 200);
  const observedSince = options.observedSince ? new Date(options.observedSince) : null;
  if (observedSince && Number.isNaN(observedSince.getTime())) throw new Error('observedSince inválido.');
  const candidates = await db.query(
    `select fo.order_id, fo.raw_data,
       (fo.first_seen_at >= now() - interval '1 hour'
         and fo.falabella_created_at >= now() - interval '2 days') as recent
     from falabella_orders fo
     where fo.company_id=$1
       and lower(coalesce(fo.status, '')) !~ '(cancel|failed)'
       and ($3::timestamptz is null or fo.synchronized_at >= $3)
       and not exists (
         select 1 from orders o join order_items oi on oi.order_id=o.id
         where o.company_id=fo.company_id and o.external_order_id=fo.order_id
       )
     order by (fo.first_seen_at >= now() - interval '1 hour') desc,
       fo.falabella_updated_at desc nulls last
     limit $2`,
    [companyId, limit, observedSince?.toISOString() || null],
  );
  if (!candidates.rows.length) return { candidates: 0, checked: 0, hydrated: 0, failed: 0 };
  const account = await ensureFalabellaOrderAccount(db, companyId);
  let cursor = 0;
  let checked = 0;
  let hydrated = 0;
  let failed = 0;
  let lastLogId = null;
  await Promise.all(Array.from({ length: Math.min(6, candidates.rows.length) }, async () => {
    while (cursor < candidates.rows.length) {
      const order = candidates.rows[cursor++];
      try {
        const response = await client.call({
          action: 'GetOrderItems',
          params: { OrderId: order.order_id },
          accept: 'application/json',
        });
        if (!response.ok || getFalabellaError(response.data)) {
          failed += 1;
          await markFalabellaItemsError(
            db,
            account.id,
            order.order_id,
            'Falabella no devolvió los items del pedido.',
          );
          const logged = operationalErrorBody(new Error('Falabella no devolvió los items del pedido.'), {
            operation: 'order_sync_items',
            context: {
              seller: options.seller,
              companyId,
              channelAccountId: account?.id,
              channelCode: 'falabella',
              runId: options.runId,
              externalOrderId: order.order_id,
            },
          });
          lastLogId = logged.logId;
          continue;
        }
        checked += 1;
        const items = extractOrderItems(response.data);
        if (!items.length) {
          failed += 1;
          await markFalabellaItemsError(
            db,
            account.id,
            order.order_id,
            'Falabella devolvió el pedido sin items.',
          );
          const logged = operationalErrorBody(new Error('Falabella devolvió el pedido sin items.'), {
            operation: 'order_sync_items',
            context: {
              seller: options.seller,
              companyId,
              channelAccountId: account.id,
              channelCode: 'falabella',
              runId: options.runId,
              externalOrderId: order.order_id,
            },
          });
          lastLogId = logged.logId;
          continue;
        }
        const normalized = normalizeFalabellaOrder({
          ...(order.raw_data || {}),
          OrderItems: { OrderItem: items },
        });
        if (!normalized) continue;
        const applyStock = options.applyRecentStock === true && order.recent === true;
        const ingested = await ingestFalabellaOrder({
          companyId,
          normalized,
          account,
          source: 'sync',
          correlationId: `falabella-sync-items:${companyId}`,
          catalogInventoryEnabled: false,
        }, db);
        if (applyStock && shouldListenStockOrder({
          status: canonicalLifecycleStatus(normalized.status),
          orderedAt: normalized.falabellaCreatedAt,
        })) {
          await enqueueStockJob({
            orderId: ingested.order.id,
            companyId,
            externalOrderId: normalized.orderId,
            orderNumber: normalized.orderNumber,
            source: 'sync',
          }, options.stockDb || db).catch(() => {});
        }
        if (!applyStock) {
          await db.query(
            `update order_items oi set
               product_id=l.product_id, listing_id=l.id, main_sku=p.main_sku,
               stock_state=case when oi.stock_state='none' then 'skipped_policy' else oi.stock_state end,
               metadata=oi.metadata || '{"backgroundCatalogHydrated":true}'::jsonb,
               updated_at=now()
             from product_listings l join products p on p.id=l.product_id
             where oi.order_id=$1 and l.channel_code='falabella'
               and l.company_id=$2 and l.status='active' and l.seller_sku=oi.sku
               and oi.product_id is null`,
            [ingested.order.id, companyId],
          );
        }
        hydrated += 1;
      } catch (error) {
        failed += 1;
        await markFalabellaItemsError(db, account.id, order.order_id, error?.message).catch(() => {});
        const logged = operationalErrorBody(error, {
          operation: 'order_sync_items',
          context: {
            seller: options.seller,
            companyId,
            channelAccountId: account?.id,
            channelCode: 'falabella',
            runId: options.runId,
            externalOrderId: order.order_id,
          },
        });
        lastLogId = logged.logId;
      }
    }
  }));
  return { candidates: candidates.rows.length, checked, hydrated, failed, lastLogId };
}

function itemNeedsStockRestock(item) {
  const status = String(item?.Status ?? item?.status ?? '').trim().toLowerCase();
  return status.includes('cancel')
    || status.includes('failed')
    || status.includes('returned')
    || status.includes('return_shipped');
}

async function ingestReconciledOrder(db, companyId, order, items, status, account, inventoryEnabled) {
  const raw = order.raw_data && typeof order.raw_data === 'object' ? order.raw_data : {};
  const normalized = normalizeFalabellaOrder({
    ...raw,
    OrderId: order.order_id || raw.OrderId,
    OrderNumber: order.order_number || raw.OrderNumber,
    Statuses: [{ Status: status }],
    OrderItems: { OrderItem: items },
    UpdatedAt: order.falabella_updated_at || raw.UpdatedAt,
  });
  if (!normalized) return;
  await ingestFalabellaOrder({
    companyId,
    normalized,
    account,
    source: 'sync',
    correlationId: `falabella-reconcile:${companyId}:${order.order_id}`,
    catalogInventoryEnabled: inventoryEnabled,
  }, db);
}

async function reconcileActionableOrderStatuses(db, companyId, client, options = {}) {
  if (typeof client?.call !== 'function') return { checked: 0, updated: 0, failed: 0 };
  const candidates = await db.query(
    `select order_id, order_number, status, falabella_created_at, falabella_updated_at, raw_data,
       case when raw_data->>'LabelCount' ~ '^[0-9]+$'
         then greatest((raw_data->>'LabelCount')::int, 1)
         else 1
       end as label_count
     from falabella_orders fo
     where fo.company_id=$1
       and (
         lower(coalesce(fo.status, '')) ~ '(^|\\|)(pending|ready_to_ship)(\\||$)'
         or exists (
           select 1
           from orders o
           join order_items oi on oi.order_id=o.id
           where o.company_id=fo.company_id
             and o.external_order_id=fo.order_id
             and oi.stock_applied_quantity > 0
         )
       )
     order by
       case when lower(coalesce(fo.status, '')) ~ '(^|\\|)(pending|ready_to_ship)(\\||$)' then 0 else 1 end,
       fo.falabella_updated_at desc nulls last
     limit 500`,
    [companyId],
  );
  let updated = 0;
  let failed = 0;
  let lastLogId = null;
  let account = null;
  for (const order of candidates.rows) {
    try {
      const response = await client.call({
        action: 'GetOrderItems',
        params: { OrderId: order.order_id },
        accept: 'application/json',
      });
      if (!response.ok || getFalabellaError(response.data)) {
        failed += 1;
        const logged = operationalErrorBody(new Error('Falabella no devolvió el estado de los items del pedido.'), {
          operation: 'order_sync_reconcile',
          context: {
            seller: options.seller,
            companyId,
            channelAccountId: account?.id,
            channelCode: 'falabella',
            runId: options.runId,
            externalOrderId: order.order_id,
          },
        });
        lastLogId = logged.logId;
        continue;
      }
      const items = extractOrderItems(response.data);
      const status = effectiveFalabellaItemStatus(items);
      if (!status) continue;
      const labelCount = falabellaLabelCount(items);
      const updatedAt = items
        .map((item) => validDate(item?.UpdatedAt ?? item?.updatedAt))
        .filter(Boolean)
        .sort()
        .at(-1) || null;
      await recordOrderLifecycle(db, {
        companyId,
        orderId: order.order_id,
        orderNumber: order.order_number,
        currentStatus: status,
        pendingAt: order.falabella_created_at,
        providerUpdatedAt: updatedAt,
      });
      const statusChanged = status !== order.status || labelCount !== Number(order.label_count || 1);
      const restockNeeded = items.some(itemNeedsStockRestock);
      if (!statusChanged && !restockNeeded) continue;
      if (statusChanged) {
        await db.query(
          `update falabella_orders
           set status=$3,
               raw_data=jsonb_set(
                 jsonb_set(coalesce(raw_data, '{}'::jsonb), '{Statuses}', to_jsonb($3::text), true),
                 '{LabelCount}', to_jsonb($5::int), true
               ),
               falabella_updated_at=coalesce($4, falabella_updated_at),
               last_seen_at=now(), synchronized_at=now()
           where company_id=$1 and order_id=$2`,
          [companyId, order.order_id, status, updatedAt, labelCount],
        );
        updated += 1;
      }
      if (restockNeeded || /cancel|returned|failed/.test(status)) {
        account ||= await ensureFalabellaOrderAccount(db, companyId);
        await ingestReconciledOrder(db, companyId, {
          ...order,
          falabella_updated_at: updatedAt || order.falabella_updated_at,
        }, items, status, account, catalogInventoryEnabledForSync(options.syncMode || 'incremental', true));
      }
    } catch (error) {
      failed += 1;
      const logged = operationalErrorBody(error, {
        operation: 'order_sync_reconcile',
        context: {
          seller: options.seller,
          companyId,
          channelAccountId: account?.id,
          channelCode: 'falabella',
          runId: options.runId,
          externalOrderId: order.order_id,
        },
      });
      lastLogId = logged.logId;
    }
  }
  return { checked: candidates.rows.length, updated, failed, lastLogId };
}

function clientFor(company) {
  return new FalabellaApiClient({
    userId: company.falabellaApiUserId,
    apiKey: company.falabellaApiKey,
    version: '2.0',
    defaultFormat: 'JSON',
    fetchImpl: providerFetch(),
  });
}

function orderItemsClientFor(company) {
  return new FalabellaApiClient({
    userId: company.falabellaApiUserId,
    apiKey: company.falabellaApiKey,
    version: '1.0',
    defaultFormat: 'JSON',
    fetchImpl: providerFetch(),
  });
}

export async function syncFalabellaOrders(companyId, options = {}, dependencies = {}) {
  const core = dependencies.pool && dependencies.getCompany ? null : await loadCore();
  const dbPool = dependencies.pool || core.pool;
  const loadCompany = dependencies.getCompany || core.getCompany;
  const makeClient = dependencies.clientFor || clientFor;
  const makeOrderItemsClient = dependencies.orderItemsClientFor || orderItemsClientFor;
  const db = await dbPool.connect();
  let locked = false;
  let runId = null;
  const mode = resolveSyncMode(options);
  try {
    const lock = await db.query('select pg_try_advisory_lock($1,$2) as locked', [LOCK_NAMESPACE, Number(companyId)]);
    locked = lock.rows[0]?.locked === true;
    if (!locked) return { status: 'already_running', companyId: Number(companyId) };

    const company = await loadCompany(Number(companyId));
    if (!company?.activo) throw new Error('Empresa no encontrada o inactiva.');
    if (!company.falabellaApiUserId?.trim() || !company.falabellaApiKey?.trim()) {
      throw new Error('La empresa no tiene credenciales de Falabella API configuradas.');
    }
    const client = makeClient(company);
    const orderItemsClient = makeOrderItemsClient(company);

    const state = await ensureState(db, companyId);
    const now = options.now ? new Date(options.now) : new Date();
    const observedSince = new Date();
    let windowFrom;
    let windowTo;
    let filters;
    if (mode === 'month') {
      ({ from: windowFrom, to: windowTo } = monthWindow(options.month));
      filters = { createdAfter: windowFrom.toISOString(), createdBefore: new Date(windowTo.getTime() - 1).toISOString(), sortDirection: 'ASC' };
    } else if (mode === 'day') {
      ({ from: windowFrom, to: windowTo } = limaDayWindow(options.date));
      filters = { createdAfter: windowFrom.toISOString(), createdBefore: new Date(windowTo.getTime() - 1).toISOString(), sortDirection: 'ASC' };
    } else if (mode === 'range' || mode === 'range_created') {
      windowFrom = new Date(options.from);
      windowTo = new Date(options.to);
      if (Number.isNaN(windowFrom.getTime()) || Number.isNaN(windowTo.getTime()) || windowFrom >= windowTo) {
        throw new Error('Rango de sincronización inválido.');
      }
      filters = mode === 'range_created'
        ? { createdAfter: windowFrom.toISOString(), createdBefore: windowTo.toISOString(), sortDirection: 'ASC' }
        : { updatedAfter: windowFrom.toISOString(), updatedBefore: windowTo.toISOString(), sortDirection: 'ASC' };
    } else {
      const window = resolveIncrementalOrderWindow({ now, cursor: state.cursor_updated_at });
      windowFrom = new Date(window.from);
      windowTo = new Date(window.to);
      if (windowFrom >= windowTo) {
        const itemHydration = await hydrateMissingOrderItems(db, companyId, orderItemsClient, {
          applyRecentStock: Boolean(state.last_successful_sync_at),
          observedSince,
          stockDb: dbPool,
        });
        const reconciliation = await reconcileActionableOrderStatuses(db, companyId, orderItemsClient);
        return { status: 'success', skipped: 'already_current', itemHydration, reconciliation, sync: await getFalabellaSyncStatus(companyId, db) };
      }
      filters = { updatedAfter: windowFrom.toISOString(), updatedBefore: windowTo.toISOString(), sortDirection: 'ASC' };
    }

    const run = await db.query(
      `insert into falabella_sync_runs (company_id, mode, status, window_from, window_to)
       values ($1,$2,'running',$3,$4) returning id`,
      [companyId, mode, windowFrom.toISOString(), windowTo.toISOString()],
    );
    runId = run.rows[0].id;
    await db.query(
      `update falabella_sync_state set status='running', last_attempt_at=now(), last_started_at=now(),
       last_error=null, updated_at=now() where company_id=$1`,
      [companyId],
    );

    let upserted = 0;
    const orderFailures = { count: 0, lastLogId: null };
    const stats = await fetchFalabellaPages(client, filters, async (orders) => {
      upserted += await upsertOrders(db, companyId, orders, {
        source: 'sync',
        syncMode: mode,
        correlationId: `falabella-sync:${runId}`,
        enqueueStock: mode === 'incremental',
        seller: company.nombreComercial || company.nombre || company.razonSocial,
        runId,
        failures: orderFailures,
        stockDb: dbPool,
      });
    });
    const itemHydration = await hydrateMissingOrderItems(db, companyId, orderItemsClient, {
      applyRecentStock: mode === 'incremental' && Boolean(state.last_successful_sync_at),
      observedSince,
      seller: company.nombreComercial || company.nombre || company.razonSocial,
      runId,
      stockDb: dbPool,
    });
    const reconciliation = await reconcileActionableOrderStatuses(db, companyId, orderItemsClient, {
      seller: company.nombreComercial || company.nombre || company.razonSocial,
      runId,
      syncMode: mode,
    });
    const failed = orderFailures.count + itemHydration.failed + reconciliation.failed;
    const syncStatus = failed > 0 ? 'partial' : 'success';

    await db.query(
      `update falabella_sync_runs set status=$2, pages_processed=$3, orders_received=$4,
       orders_upserted=$5, finished_at=now() where id=$1`,
      [runId, syncStatus, stats.pages, stats.received, upserted],
    );
    await db.query(
      `update falabella_sync_state set status=$7, last_finished_at=now(),
       last_successful_sync_at=case when $7='success' then now() else last_successful_sync_at end,
       last_error=case when $7='partial' then $8 else null end, last_pages_processed=$2,
       last_orders_received=$3, last_orders_upserted=$4,
       cursor_updated_at=case when $7='success' and $5='incremental' then $6 else cursor_updated_at end,
       updated_at=now() where company_id=$1`,
      [
        companyId,
        stats.pages,
        stats.received,
        upserted,
        mode,
        windowTo.toISOString(),
        syncStatus,
        syncStatus === 'partial' ? `${failed} pedido(s) requieren reintento.` : null,
      ],
    );
    if (mode === 'month' && syncStatus === 'success') {
      await db.query(
        `insert into falabella_sync_windows (company_id, month, last_successful_sync_at, orders_received)
         values ($1,$2,now(),$3)
         on conflict (company_id, month) do update set
           last_successful_sync_at=now(), orders_received=excluded.orders_received`,
        [companyId, options.month, stats.received],
      );
    }
    return {
      status: syncStatus,
      runId,
      mode,
      ...stats,
      upserted,
      failed,
      lastLogId: reconciliation.lastLogId || itemHydration.lastLogId || orderFailures.lastLogId,
      itemHydration,
      reconciliation,
      sync: await getFalabellaSyncStatus(companyId, db),
    };
  } catch (error) {
    const message = String(error?.message || error).slice(0, 2000);
    if (runId) await db.query(
      `update falabella_sync_runs set status='error', error=$2, finished_at=now() where id=$1`,
      [runId, message],
    ).catch(() => {});
    await db.query(
      `update falabella_sync_state set status='error', last_finished_at=now(), last_error=$2, updated_at=now()
       where company_id=$1`,
      [companyId, message],
    ).catch(() => {});
    if (runId && error && typeof error === 'object') error.runId = runId;
    throw error;
  } finally {
    if (locked) await db.query('select pg_advisory_unlock($1,$2)', [LOCK_NAMESPACE, Number(companyId)]).catch(() => {});
    db.release();
  }
}

export async function attachFalabellaOrderItems(client, order) {
  const orderId = String(order?.OrderId || order?.orderId || '').trim();
  if (!orderId || typeof client?.call !== 'function') return order;
  try {
    const response = await client.call({
      action: 'GetOrderItems',
      params: { OrderId: orderId },
      accept: 'application/json',
    });
    if (!response?.ok) return order;
    const items = extractOrderItems(response.data);
    if (!items.length) return order;
    return { ...order, OrderItems: { OrderItem: items } };
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'falabella.webhook.items_attach_failed',
      orderId,
      message: String(error?.message || error),
    }));
    return order;
  }
}

export async function upsertFalabellaWebhookOrder(companyId, order, db) {
  if (db) return upsertOrders(db, Number(companyId), [order], { source: 'webhook', enqueueStock: true });
  const { pool } = await loadCore();
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock($1,$2)', [LOCK_NAMESPACE, Number(companyId)]);
    const result = await upsertOrders(client, Number(companyId), [order], { source: 'webhook', enqueueStock: true });
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function getFalabellaSyncStatus(companyId, db) {
  const target = db || (await loadCore()).pool;
  const result = await target.query(
    `select company_id, enabled, status, full_sync_completed, initial_sync_from,
       backfill_cursor_date, cursor_updated_at, last_attempt_at, last_started_at,
       last_finished_at, last_successful_sync_at, last_error, last_pages_processed,
       last_orders_received, last_orders_upserted, sync_interval_minutes
     from falabella_sync_state where company_id=$1`,
    [companyId],
  );
  const row = result.rows[0] || null;
  if (!row) return null;
  return {
    companyId: row.company_id,
    enabled: row.enabled,
    status: row.status,
    fullSyncCompleted: row.full_sync_completed,
    initialSyncFrom: row.initial_sync_from,
    backfillCursorDate: row.backfill_cursor_date,
    dataUpdatedThrough: row.cursor_updated_at,
    lastAttemptAt: row.last_attempt_at,
    lastStartedAt: row.last_started_at,
    lastFinishedAt: row.last_finished_at,
    lastSuccessfulSyncAt: row.last_successful_sync_at,
    lastError: row.last_error,
    pagesProcessed: row.last_pages_processed,
    ordersReceived: row.last_orders_received,
    ordersUpserted: row.last_orders_upserted,
    syncIntervalMinutes: row.sync_interval_minutes,
  };
}

function uploadReadiness(estadoSunat, xmlPath, cdrPath, { allowAnnulled = false } = {}) {
  const estado = String(estadoSunat || '').toUpperCase();
  const accepted = estado === 'ACEPTADO' || (allowAnnulled && estado === 'ANULADO');
  if (!accepted) {
    return { canUploadPdf: false, uploadBlockedReason: 'El documento debe estar ACEPTADO por SUNAT para subirlo.' };
  }
  // Boletas por resumen: a menudo solo cdr_path (CDR del RC). Facturas individuales: xml+cdr.
  if (xmlPath || cdrPath) return { canUploadPdf: true, uploadBlockedReason: '' };
  return {
    canUploadPdf: false,
    uploadBlockedReason: 'Documento aceptado sin XML ni CDR guardados; no se puede generar/subir el PDF a Falabella.',
  };
}

function boletaFalabellaUploadedAt(datosAdicionales) {
  try {
    const raw = typeof datosAdicionales === 'string' ? JSON.parse(datosAdicionales) : datosAdicionales;
    if (!raw || typeof raw !== 'object') return '';
    if (!Array.isArray(raw)) {
      const at = raw?.falabellaPdfUpload?.uploadedAt || raw?.falabellaPdfUploadedAt;
      return at ? String(at) : '';
    }
    for (const entry of raw) {
      const at = entry?.falabellaPdfUpload?.uploadedAt || entry?.falabellaPdfUploadedAt;
      if (at) return String(at);
    }
  } catch { /* ignore */ }
  return '';
}

function facturaFalabellaUploadedAt(respuestaFalabella, updatedAt) {
  if (!respuestaFalabella) return '';
  const raw = updatedAt;
  const ms = raw ? Number(raw) * (Number(raw) < 1e12 ? 1000 : 1) : Date.now();
  try { return new Date(ms).toISOString(); } catch { return new Date().toISOString(); }
}

function documentFromRow(row) {
  const options = [];
  const boletaReady = uploadReadiness(row.boleta_estado, row.boleta_xml, row.boleta_cdr, { allowAnnulled: true });
  const facturaReady = uploadReadiness(row.factura_estado, row.factura_xml, row.factura_cdr);
  const creditReady = uploadReadiness(row.credit_note_estado, row.credit_note_xml, row.credit_note_cdr);
  const boleta = row.boleta_id ? {
    id: row.boleta_id, numeroCompleto: row.boleta_numero, fechaEmision: row.boleta_fecha,
    total: row.boleta_total,
    pdfPath: row.boleta_pdf, xmlPath: row.boleta_xml, cdrPath: row.boleta_cdr,
    estadoSunat: row.boleta_estado, respuestaSunat: row.boleta_respuesta || '',
    falabellaPdfUploadedAt: boletaFalabellaUploadedAt(row.boleta_datos_adicionales),
    ...boletaReady,
  } : null;
  const factura = row.factura_id ? {
    id: row.factura_id, numeroCompleto: row.factura_numero, fechaEmision: row.factura_fecha,
    total: row.factura_total,
    pdfPath: row.factura_pdf, xmlPath: row.factura_xml, cdrPath: row.factura_cdr,
    estadoSunat: row.factura_estado, respuestaSunat: row.factura_respuesta || '',
    falabellaPdfUploadedAt: facturaFalabellaUploadedAt(row.factura_respuesta_falabella, row.factura_updated_at),
    ...facturaReady,
  } : null;
  const creditNote = row.credit_note_id ? {
    id: row.credit_note_id, numeroCompleto: row.credit_note_numero, fechaEmision: row.credit_note_fecha,
    pdfPath: row.credit_note_pdf, xmlPath: row.credit_note_xml, cdrPath: row.credit_note_cdr,
    estadoSunat: row.credit_note_estado, respuestaSunat: row.credit_note_respuesta || '',
    ...creditReady,
  } : null;
  if (boleta) options.push({ kind: 'BOLETA', source: 'local_boleta', boletaId: boleta.id, invoiceNumber: boleta.numeroCompleto, invoiceDate: boleta.fechaEmision, invoiceType: 'BOLETA', ...boleta });
  if (factura) options.push({ kind: 'FACTURA', source: 'local_factura', facturaId: factura.id, invoiceNumber: factura.numeroCompleto, invoiceDate: factura.fechaEmision, invoiceType: 'FACTURA', ...factura });
  if (creditNote) options.push({ kind: 'NOTA_DE_CREDITO', source: 'local_credit_note', creditNoteId: creditNote.id, invoiceNumber: creditNote.numeroCompleto, invoiceDate: creditNote.fechaEmision, invoiceType: 'NOTA_DE_CREDITO', ...creditNote });
  if (!factura) options.push({ kind: 'FACTURA', source: 'manual', invoiceNumber: '', invoiceDate: '', invoiceType: 'FACTURA' });
  return { orderNumber: row.order_number, boleta, factura, creditNote, options, defaultKind: boleta ? 'BOLETA' : factura ? 'FACTURA' : creditNote ? 'NOTA_DE_CREDITO' : 'FACTURA' };
}

export async function listLocalFalabellaOrders(companyId, filters = {}, db) {
  const target = db || (await loadCore()).pool;
  const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 1000);
  const offset = Math.max(Number(filters.offset || 0), 0);
  const values = [Number(companyId)];
  const where = ['fo.company_id=$1'];
  if (filters.createdAfter) { values.push(filters.createdAfter); where.push(`fo.falabella_created_at >= $${values.length}`); }
  if (filters.createdBefore) { values.push(filters.createdBefore); where.push(`fo.falabella_created_at <= $${values.length}`); }
  values.push(limit, offset);
  const query = await target.query(
    `select fo.order_number, fo.raw_data,
       b.id boleta_id, b.numero_completo boleta_numero, b.fecha_emision boleta_fecha,
       b.mto_imp_venta boleta_total,
       b.pdf_path boleta_pdf, b.xml_path boleta_xml, b.cdr_path boleta_cdr,
       b.estado_sunat boleta_estado, b.respuesta_sunat boleta_respuesta,
       b.datos_adicionales boleta_datos_adicionales,
       f.id factura_id, f.numero_completo factura_numero, f.fecha_emision factura_fecha,
       f.mto_imp_venta factura_total,
       f.pdf_path factura_pdf, f.xml_path factura_xml, f.cdr_path factura_cdr,
       f.estado_sunat factura_estado, f.respuesta_sunat factura_respuesta,
       f.respuesta_falabella factura_respuesta_falabella, f.updated_at factura_updated_at,
       cn.id credit_note_id, cn.numero_completo credit_note_numero, cn.fecha_emision credit_note_fecha,
       cn.pdf_path credit_note_pdf, cn.xml_path credit_note_xml, cn.cdr_path credit_note_cdr,
       cn.estado_sunat credit_note_estado, cn.respuesta_sunat credit_note_respuesta,
       count(*) over()::int total_count
     from falabella_orders fo
     left join lateral (select * from boletas where company_id=fo.company_id and order_number=fo.order_number order by id desc limit 1) b on true
     left join lateral (select * from facturas where company_id=fo.company_id and order_number=fo.order_number order by id desc limit 1) f on true
     left join lateral (
       select cn.* from credit_notes cn join boletas ab on ab.id=cn.affected_boleta_id
       where cn.company_id=fo.company_id and ab.order_number=fo.order_number order by cn.id desc limit 1
     ) cn on true
     where ${where.join(' and ')}
     order by fo.falabella_created_at desc nulls last
     limit $${values.length - 1} offset $${values.length}`,
    values,
  );
  const orders = query.rows.map((row) => ({ ...row.raw_data, __resolved: documentFromRow(row) }));
  const month = String(filters.createdAfter || '').slice(0, 7);
  const coverage = /^\d{4}-\d{2}$/.test(month)
    ? (await target.query('select last_successful_sync_at, orders_received from falabella_sync_windows where company_id=$1 and month=$2', [companyId, month])).rows[0] || null
    : null;
  return { orders, totalCount: query.rows[0]?.total_count || 0, sync: await getFalabellaSyncStatus(companyId, target), coverage, source: 'postgres' };
}

export function startFalabellaSyncScheduler() {
  let running = false;
  const tick = async () => {
    // El flag vive en BD (panel superadmin); la env solo actúa como kill-switch.
    if (!(await isFalabellaSyncEnabled())) return;
    if (running) return;
    running = true;
    try {
      const { listCompanies } = await loadCore();
      const companies = (await listCompanies()).filter((company) => company.activo && company.falabellaApiUserId?.trim() && company.falabellaApiKey?.trim());
      for (const company of companies) {
        const state = await getFalabellaSyncStatus(company.id);
        if (!state?.enabled) continue;
        const lastReference = state.lastAttemptAt || state.lastSuccessfulSyncAt;
        const last = lastReference ? new Date(lastReference).getTime() : 0;
        const interval = Math.max(1, Number(state.syncIntervalMinutes || 15)) * 60_000;
        if (Date.now() - last >= interval) await syncFalabellaOrders(company.id).catch((error) => console.error('[FALABELLA SYNC]', company.id, error.message));
      }
    } finally { running = false; }
  };
  setTimeout(() => { tick().catch(() => {}); }, 30_000);
  setInterval(() => { tick().catch(() => {}); }, 60_000);
}
