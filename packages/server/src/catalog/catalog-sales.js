import { FalabellaApiClient, getFalabellaError, normalizeGetOrdersResult } from '@zentofact/falabella-api';
import { ingestFalabellaOrder } from '../order-adapters/falabella.js';
import { normalizeFalabellaOrder } from '../falabella-sync.js';
import { httpError, loadCore, positiveInt } from './utils.js';

const SALES_RANGES = new Set(['30', '90', '365', 'all']);
const ACTIVITY_KINDS = new Set(['sales', 'returns']);
const MAX_REMOTE_ORDERS = 500;
const LIVE_PAGE_SIZE = 100;
const MAX_LIVE_PAGES = 5;
const LIVE_OVERLAP_MS = 10 * 60_000;
export const LIVE_WINDOW_DAYS = 2;

function extractOrderItems(document) {
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

async function mapConcurrent(items, concurrency, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index], index);
    }
  }));
  return output;
}

async function resolveHydratedOrderItems(target, orderId, companyId) {
  const result = await target.query(
    `update order_items oi set
       product_id=l.product_id,
       listing_id=l.id,
       main_sku=p.main_sku,
       stock_state=case when oi.stock_state='none' then 'skipped_policy' else oi.stock_state end,
       metadata=oi.metadata || '{"catalogSalesHydrated":true}'::jsonb,
       updated_at=now()
     from product_listings l
     join products p on p.id=l.product_id
     where oi.order_id=$1
       and l.channel_code='falabella'
       and l.company_id=$2
       and l.status='active'
       and l.seller_sku=oi.sku
       and oi.product_id is null
     returning oi.id`,
    [orderId, companyId],
  );
  return result.rows.length;
}

async function repairHydratedQuantities(target, productId) {
  const result = await target.query(
    `update order_items set
       quantity=1,
       total=coalesce(total, unit_price),
       updated_at=now()
     where product_id=$1
       and metadata @> '{"catalogSalesHydrated":true}'::jsonb
       and quantity <= 0
       and nullif(trim(coalesce(raw_data->>'Quantity', '')), '') is null
     returning id`,
    [productId],
  );
  return result.rows.length;
}

async function upsertLiveOrderHeaders(target, companyId, orders) {
  const rows = orders.map(normalizeFalabellaOrder).filter(Boolean).map((order) => ({
    order_id: order.orderId,
    order_number: order.orderNumber,
    falabella_created_at: order.falabellaCreatedAt,
    falabella_updated_at: order.falabellaUpdatedAt,
    status: order.status,
    invoice_required: order.invoiceRequired,
    grand_total: order.grandTotal,
    currency: order.currency,
    raw_data: order.raw,
  }));
  if (!rows.length) return 0;
  await target.query(
    `insert into falabella_orders (
       company_id, order_id, order_number, falabella_created_at, falabella_updated_at,
       status, invoice_required, grand_total, currency, raw_data,
       first_seen_at, last_seen_at, synchronized_at
     ) select $1, x.order_id, x.order_number, x.falabella_created_at,
       x.falabella_updated_at, x.status, x.invoice_required, x.grand_total,
       x.currency, x.raw_data, now(), now(), now()
     from jsonb_to_recordset($2::jsonb) as x(
       order_id text, order_number text, falabella_created_at timestamptz,
       falabella_updated_at timestamptz, status text, invoice_required boolean,
       grand_total numeric, currency text, raw_data jsonb
     )
     on conflict (company_id, order_id) do update set
       order_number=excluded.order_number,
       falabella_created_at=coalesce(excluded.falabella_created_at, falabella_orders.falabella_created_at),
       falabella_updated_at=coalesce(excluded.falabella_updated_at, falabella_orders.falabella_updated_at),
       status=excluded.status,
       invoice_required=excluded.invoice_required,
       grand_total=excluded.grand_total,
       currency=excluded.currency,
       raw_data=excluded.raw_data,
       last_seen_at=now(),
       synchronized_at=now()`,
    [companyId, JSON.stringify(rows)],
  );
  return rows.length;
}

function liveWindowStart() {
  return new Date(Date.now() - LIVE_WINDOW_DAYS * 86_400_000).toISOString();
}

async function refreshLiveOrderHeaders(target, companies, kind, dependencies) {
  const orderClientFactory = dependencies.orderClientFactory || ((company) => new FalabellaApiClient({
    userId: company.falabellaApiUserId,
    apiKey: company.falabellaApiKey,
    version: '2.0',
    defaultFormat: 'JSON',
  }));
  const stats = {
    sellersRequested: companies.length,
    sellersSucceeded: 0,
    pages: 0,
    ordersReceived: 0,
    failed: 0,
    truncated: false,
    incrementalSellers: 0,
    bootstrapSellers: 0,
    windowDays: LIVE_WINDOW_DAYS,
    queriedAt: new Date().toISOString(),
  };
  const rangeFloor = new Date(liveWindowStart()).getTime();
  const syncStates = companies.length ? (await target.query(
    `select company_id, cursor_updated_at
     from falabella_sync_state where company_id=any($1::int[]) and enabled=true`,
    [companies.map((company) => Number(company.id))],
  )).rows : [];
  const cursors = new Map(syncStates.map((row) => [Number(row.company_id), row.cursor_updated_at]));
  const requestedAt = new Date().toISOString();
  await mapConcurrent(companies, 3, async (company) => {
    if (!company?.falabellaApiUserId?.trim() || !company?.falabellaApiKey?.trim()) {
      stats.failed += 1;
      return;
    }
    try {
      const client = orderClientFactory(company);
      const cursorValue = cursors.get(Number(company.id));
      const cursorTime = cursorValue ? new Date(cursorValue).getTime() : Number.NaN;
      const updatedAfter = Number.isFinite(cursorTime)
        ? new Date(Math.max(rangeFloor, cursorTime - LIVE_OVERLAP_MS)).toISOString()
        : null;
      if (updatedAfter) stats.incrementalSellers += 1;
      else stats.bootstrapSellers += 1;
      let completed = false;
      for (let page = 0; page < MAX_LIVE_PAGES; page += 1) {
        const response = await client.getOrdersV2({
          createdAfter: updatedAfter ? undefined : new Date(rangeFloor).toISOString(),
          createdBefore: updatedAfter ? undefined : requestedAt,
          updatedAfter: updatedAfter || undefined,
          updatedBefore: updatedAfter ? requestedAt : undefined,
          status: kind === 'returns' ? 'returned' : undefined,
          sortDirection: 'DESC',
          limit: LIVE_PAGE_SIZE,
          offset: page * LIVE_PAGE_SIZE,
        });
        const apiError = getFalabellaError(response.data);
        if (!response.ok || apiError) throw new Error(apiError?.Head?.ErrorMessage || `Falabella respondió HTTP ${response.status}.`);
        const orders = normalizeGetOrdersResult(response.data).orders || [];
        stats.pages += 1;
        stats.ordersReceived += orders.length;
        await upsertLiveOrderHeaders(target, Number(company.id), orders);
        if (orders.length < LIVE_PAGE_SIZE) {
          completed = true;
          break;
        }
      }
      if (completed) stats.sellersSucceeded += 1;
      else stats.truncated = true;
    } catch (error) {
      stats.failed += 1;
      console.warn(JSON.stringify({
        event: 'catalog.activity.live_headers_failed',
        companyId: company?.id,
        kind,
        message: String(error?.message || error),
      }));
    }
  });
  return stats;
}

function coverageWithLive(coverage, live) {
  const liveVerified = coverage.sellers > 0
    && live.sellersSucceeded === coverage.sellers
    && live.failed === 0
    && !live.truncated;
  return {
    ...coverage,
    liveVerified,
    liveQueriedAt: live.queriedAt,
    complete: coverage.orderHeaders === coverage.orderDetails && liveVerified,
  };
}

async function activityCoverage(target, companyIds, range, kind) {
  if (!companyIds.length) return {
    sellers: 0,
    orderHeaders: 0,
    orderDetails: 0,
    complete: true,
    dataUpdatedThrough: null,
    lastSuccessfulSyncAt: null,
  };
  const values = [companyIds];
  const rangeClause = range === 'all'
    ? ''
    : (values.push(Number(range)), `and fo.falabella_created_at >= now() - ($${values.length} * interval '1 day')`);
  const statusClause = kind === 'returns'
    ? `lower(coalesce(fo.status, '')) ~ '(return)'`
    : `lower(coalesce(fo.status, '')) !~ '(cancel|return|failed)'`;
  const [ordersResult, syncResult] = await Promise.all([
    target.query(
      `select count(*)::int as order_headers,
         count(*) filter (where exists (
           select 1 from orders o
           join order_items oi on oi.order_id=o.id
           where o.company_id=fo.company_id and o.external_order_id=fo.order_id
         ))::int as order_details
       from falabella_orders fo
       where fo.company_id=any($1::int[]) and ${statusClause} ${rangeClause}`,
      values,
    ),
    target.query(
      `select count(*)::int as sellers,
         count(*) filter (where status='success')::int as successful_sellers,
         min(cursor_updated_at) as data_updated_through,
         min(last_successful_sync_at) as last_successful_sync_at
       from falabella_sync_state where company_id=any($1::int[]) and enabled=true`,
      [companyIds],
    ),
  ]);
  const orders = ordersResult.rows[0] || {};
  const sync = syncResult.rows[0] || {};
  const orderHeaders = Number(orders.order_headers || 0);
  const orderDetails = Number(orders.order_details || 0);
  const sellers = Number(sync.sellers || 0);
  return {
    sellers: companyIds.length,
    orderHeaders,
    orderDetails,
    complete: orderHeaders === orderDetails
      && sellers === companyIds.length
      && Number(sync.successful_sellers || 0) === companyIds.length,
    dataUpdatedThrough: sync.data_updated_through || null,
    lastSuccessfulSyncAt: sync.last_successful_sync_at || null,
  };
}

async function loadCompaniesById(companyIds, dependencies, core) {
  const getCompany = dependencies.getCompany || core.getCompany;
  return (await Promise.all(companyIds.map((companyId) => getCompany(companyId)))).filter(Boolean);
}

async function listFalabellaCompanyIds(target, companyId) {
  if (companyId) return [companyId];
  const rows = (await target.query(
    `select id from companies
     where coalesce(activo, true) = true
       and nullif(trim(falabella_api_user_id), '') is not null
       and nullif(trim(falabella_api_key), '') is not null
     order by id`,
  )).rows;
  return rows.map((row) => Number(row.id));
}

async function hydrateMissingRecentOrders(target, companies, kind, dependencies = {}) {
  const companyIds = companies.map((company) => Number(company.id)).filter((id) => id > 0);
  if (!companyIds.length) {
    return { candidates: 0, checked: 0, hydrated: 0, resolvedItems: 0, failed: 0, truncated: false };
  }
  const statusClause = kind === 'returns'
    ? `lower(coalesce(fo.status, '')) ~ '(return)'`
    : `lower(coalesce(fo.status, '')) !~ '(cancel|return|failed)'`;
  const candidates = (await target.query(
    `select fo.company_id, fo.order_id, fo.raw_data
     from falabella_orders fo
     where fo.company_id=any($1::int[])
       and ${statusClause}
       and fo.falabella_created_at >= now() - ($2 * interval '1 day')
       and not exists (
         select 1 from orders o
         join order_items oi on oi.order_id=o.id
         where o.company_id=fo.company_id and o.external_order_id=fo.order_id
       )
     order by fo.falabella_created_at desc
     limit $3`,
    [companyIds, LIVE_WINDOW_DAYS, MAX_REMOTE_ORDERS + 1],
  )).rows;
  const truncated = candidates.length > MAX_REMOTE_ORDERS;
  const pending = candidates.slice(0, MAX_REMOTE_ORDERS);
  if (!pending.length) return { candidates: 0, checked: 0, hydrated: 0, resolvedItems: 0, failed: 0, truncated: false };

  const detailClientFactory = dependencies.detailClientFactory || dependencies.clientFactory || ((company) => new FalabellaApiClient({
    userId: company.falabellaApiUserId,
    apiKey: company.falabellaApiKey,
    version: '1.0',
    defaultFormat: 'JSON',
  }));
  const clients = new Map();
  for (const company of companies) {
    const companyId = Number(company.id);
    if (!company?.falabellaApiUserId?.trim() || !company?.falabellaApiKey?.trim()) continue;
    clients.set(companyId, detailClientFactory(company));
  }

  const correlationId = dependencies.correlationId || 'catalog-sales:recent';
  let checked = 0;
  let hydrated = 0;
  let resolvedItems = 0;
  let failed = 0;
  await mapConcurrent(pending, 8, async (order) => {
    const companyId = Number(order.company_id);
    const client = clients.get(companyId);
    if (!client) {
      failed += 1;
      return;
    }
    try {
      const response = await client.call({
        action: 'GetOrderItems',
        params: { OrderId: order.order_id },
        accept: 'application/json',
      });
      if (!response.ok || getFalabellaError(response.data)) {
        failed += 1;
        return;
      }
      checked += 1;
      const items = extractOrderItems(response.data);
      if (!items.length) return;
      const normalized = normalizeFalabellaOrder({
        ...(order.raw_data || {}),
        OrderItems: { OrderItem: items },
      });
      if (!normalized) return;
      const ingested = await ingestFalabellaOrder({
        companyId,
        normalized,
        source: 'system',
        correlationId,
        catalogInventoryEnabled: false,
      });
      hydrated += 1;
      resolvedItems += await resolveHydratedOrderItems(target, ingested.order.id, companyId);
    } catch (error) {
      failed += 1;
      console.warn(JSON.stringify({
        event: 'catalog.sales.hydration_failed',
        companyId,
        orderId: order.order_id,
        message: String(error?.message || error),
      }));
    }
  });

  return {
    candidates: pending.length,
    checked,
    hydrated,
    resolvedItems,
    failed,
    truncated,
  };
}

/**
 * Recupera líneas recientes solo cuando el operador abre Ventas, Devoluciones
 * o actualiza Salidas de hoy. Falabella se consulta como máximo 2 días; el
 * histórico se lee de orders/order_items. Las líneas se marcan skipped_policy
 * para no backfillear stock.
 */
export async function hydrateProductActivity(id, filters = {}, db, dependencies = {}) {
  const core = dependencies.core || await loadCore();
  const target = db || core.pool;
  const productId = positiveInt(id, 'productId');
  const range = String(filters.range || '30').trim().toLowerCase();
  const kind = String(filters.kind || 'sales').trim().toLowerCase();
  if (!SALES_RANGES.has(range)) throw httpError('range inválido.');
  if (!ACTIVITY_KINDS.has(kind)) throw httpError('kind inválido.');
  const repairedItems = await repairHydratedQuantities(target, productId);

  const listings = (await target.query(
    `select distinct company_id
     from product_listings
     where product_id=$1 and channel_code='falabella' and status='active'`,
    [productId],
  )).rows;
  const companyIds = listings.map((row) => Number(row.company_id));
  const companies = await loadCompaniesById(companyIds, dependencies, core);
  const live = await refreshLiveOrderHeaders(target, companies, kind, dependencies);
  if (!companyIds.length) {
    return {
      candidates: 0, checked: 0, hydrated: 0, resolvedItems: 0, repairedItems, failed: 0, truncated: false,
      live, coverage: coverageWithLive(await activityCoverage(target, [], range, kind), live),
    };
  }
  const hydration = await hydrateMissingRecentOrders(target, companies, kind, {
    ...dependencies,
    correlationId: `catalog-sales:${productId}`,
  });
  return {
    ...hydration,
    repairedItems,
    live,
    coverage: coverageWithLive(await activityCoverage(target, companyIds, range, kind), live),
  };
}

export async function hydrateRecentSalesActivity(filters = {}, db, dependencies = {}) {
  const core = dependencies.core || await loadCore();
  const target = db || core.pool;
  const companyId = filters.companyId ? positiveInt(filters.companyId, 'companyId') : null;
  const companyIds = await listFalabellaCompanyIds(target, companyId);
  const companies = await loadCompaniesById(companyIds, dependencies, core);
  const live = await refreshLiveOrderHeaders(target, companies, 'sales', dependencies);
  const hydration = await hydrateMissingRecentOrders(target, companies, 'sales', {
    ...dependencies,
    correlationId: 'catalog-sales:today',
  });
  return {
    ...hydration,
    live,
    coverage: coverageWithLive(await activityCoverage(target, companyIds, String(LIVE_WINDOW_DAYS), 'sales'), live),
  };
}
