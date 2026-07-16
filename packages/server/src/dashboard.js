const RESPONSE_CACHE_TTL_MS = 2 * 60_000;
const MATERIALIZED_VIEW_TTL_MS = 5 * 60_000;
const REFRESH_LOCK_NAMESPACE = 82451;
const REFRESH_LOCK_KEY = 19;
const responseCache = new Map();
let refreshPromise = null;
let refreshTimer = null;
let defaultPoolPromise = null;

async function resolvePool(db) {
  if (db) return db;
  defaultPoolPromise ||= import('@zentofact/core').then((core) => core.pool);
  return defaultPoolPromise;
}

function limaDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function parseDate(value, fallback) {
  const normalized = String(value || fallback || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error('Fecha inválida');
  const date = new Date(`${normalized}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw new Error('Fecha inválida');
  }
  return normalized;
}

function addDays(value, amount) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function diffDays(from, to) {
  const start = new Date(`${from}T12:00:00.000Z`).getTime();
  const end = new Date(`${to}T12:00:00.000Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}

function optionalPositiveInt(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} inválido`);
  return parsed;
}

export function parseDashboardFilters(input = {}) {
  const to = parseDate(input.to, limaDate());
  const from = parseDate(input.from, addDays(to, -29));
  const span = diffDays(from, to);
  if (span < 0) throw new Error('La fecha inicial no puede ser posterior a la final');
  if (span > 730) throw new Error('El dashboard admite periodos de hasta 731 días');
  const previousTo = addDays(from, -1);
  const previousFrom = addDays(previousTo, -span);
  return {
    from,
    to,
    previousFrom,
    previousTo,
    companyId: optionalPositiveInt(input.companyId, 'Empresa'),
    branchId: optionalPositiveInt(input.branchId, 'Sucursal'),
  };
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function percentageDelta(current, previous) {
  const a = numeric(current);
  const b = numeric(previous);
  if (b === 0) return a === 0 ? 0 : null;
  return ((a - b) / Math.abs(b)) * 100;
}

function normalizeSummary(raw = {}) {
  return {
    grossDemand: numeric(raw.grossDemand),
    netSales: numeric(raw.netSales),
    cancelledSales: numeric(raw.cancelledSales),
    orders: numeric(raw.orders),
    totalOrders: numeric(raw.totalOrders),
    cancelledOrders: numeric(raw.cancelledOrders),
    averageTicket: numeric(raw.averageTicket),
    activeStores: numeric(raw.activeStores),
  };
}

function fillDailySeries(from, to, rows, empty) {
  const byDay = new Map((rows || []).map((row) => [String(row.day).slice(0, 10), row]));
  const result = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    result.push({ day, ...empty, ...(byDay.get(day) || {}) });
  }
  return result;
}

function normalizeRows(rows = [], fields = []) {
  return rows.map((row) => {
    const normalized = { ...row };
    for (const field of fields) normalized[field] = numeric(row[field]);
    return normalized;
  });
}

const DASHBOARD_SQL = `
  WITH
  sales_source AS MATERIALIZED (
    SELECT
      fo.company_id,
      (fo.falabella_created_at AT TIME ZONE 'America/Lima')::date AS day,
      COALESCE(fo.grand_total, 0) AS amount,
      lower(COALESCE(fo.status, '')) ~ '(canceled|cancelled|cancelada|returned|devuelta|failed)' AS is_cancelled
    FROM falabella_orders fo
    JOIN companies c ON c.id = fo.company_id AND c.activo IS NOT FALSE
    WHERE (fo.falabella_created_at AT TIME ZONE 'America/Lima')::date BETWEEN $3::date AND $2::date
      AND ($5::int IS NULL OR fo.company_id = $5)

    UNION ALL

    SELECT
      b.company_id,
      b.fecha_emision::date AS day,
      CASE WHEN COALESCE(b.mto_imp_venta, '') ~ '^-?[0-9]+([.][0-9]+)?$'
        THEN b.mto_imp_venta::numeric ELSE 0 END AS amount,
      UPPER(COALESCE(b.estado_sunat, '')) IN ('ANULADO', 'REEMPLAZADO')
        OR EXISTS (SELECT 1 FROM credit_notes cn WHERE cn.affected_boleta_id = b.id) AS is_cancelled
    FROM boletas b
    JOIN companies c ON c.id = b.company_id AND c.activo IS NOT FALSE
    WHERE b.fecha_emision ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND b.fecha_emision::date BETWEEN $3::date AND $2::date
      AND ($5::int IS NULL OR b.company_id = $5)
      AND NOT EXISTS (
        SELECT 1 FROM falabella_orders fo
        WHERE fo.company_id = b.company_id AND fo.order_number = b.order_number
      )

    UNION ALL

    SELECT
      f.company_id,
      f.fecha_emision::date AS day,
      CASE WHEN COALESCE(f.mto_imp_venta, '') ~ '^-?[0-9]+([.][0-9]+)?$'
        THEN f.mto_imp_venta::numeric ELSE 0 END AS amount,
      UPPER(COALESCE(f.estado_sunat, '')) IN ('ANULADO', 'REEMPLAZADO') AS is_cancelled
    FROM facturas f
    JOIN companies c ON c.id = f.company_id AND c.activo IS NOT FALSE
    WHERE f.fecha_emision ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND f.fecha_emision::date BETWEEN $3::date AND $2::date
      AND ($5::int IS NULL OR f.company_id = $5)
      AND NOT EXISTS (
        SELECT 1 FROM falabella_orders fo
        WHERE fo.company_id = f.company_id AND fo.order_number = f.order_number
      )
  ),
  current_orders AS MATERIALIZED (
    SELECT * FROM sales_source WHERE day BETWEEN $1::date AND $2::date
  ),
  previous_orders AS MATERIALIZED (
    SELECT * FROM sales_source WHERE day BETWEEN $3::date AND $4::date
  ),
  current_summary AS (
    SELECT
      COALESCE(SUM(amount), 0) AS gross_demand,
      COALESCE(SUM(amount) FILTER (WHERE NOT is_cancelled), 0) AS net_sales,
      COALESCE(SUM(amount) FILTER (WHERE is_cancelled), 0) AS cancelled_sales,
      COUNT(*) FILTER (WHERE NOT is_cancelled) AS orders,
      COUNT(*) AS total_orders,
      COUNT(*) FILTER (WHERE is_cancelled) AS cancelled_orders,
      COUNT(DISTINCT company_id) FILTER (WHERE NOT is_cancelled) AS active_stores
    FROM current_orders
  ),
  previous_summary AS (
    SELECT
      COALESCE(SUM(amount), 0) AS gross_demand,
      COALESCE(SUM(amount) FILTER (WHERE NOT is_cancelled), 0) AS net_sales,
      COALESCE(SUM(amount) FILTER (WHERE is_cancelled), 0) AS cancelled_sales,
      COUNT(*) FILTER (WHERE NOT is_cancelled) AS orders,
      COUNT(*) AS total_orders,
      COUNT(*) FILTER (WHERE is_cancelled) AS cancelled_orders,
      COUNT(DISTINCT company_id) FILTER (WHERE NOT is_cancelled) AS active_stores
    FROM previous_orders
  ),
  sales_daily AS (
    SELECT
      day,
      COALESCE(SUM(amount) FILTER (WHERE NOT is_cancelled), 0) AS net_sales,
      COALESCE(SUM(amount) FILTER (WHERE is_cancelled), 0) AS cancelled_sales,
      COUNT(*) FILTER (WHERE NOT is_cancelled) AS orders
    FROM current_orders
    GROUP BY day
    ORDER BY day
  ),
  previous_sales_daily AS (
    SELECT
      day,
      COALESCE(SUM(amount) FILTER (WHERE NOT is_cancelled), 0) AS net_sales
    FROM previous_orders
    GROUP BY day
    ORDER BY day
  ),
  company_totals AS (
    SELECT
      company_id,
      COALESCE(SUM(amount) FILTER (WHERE NOT is_cancelled), 0) AS net_sales,
      COALESCE(SUM(amount) FILTER (WHERE is_cancelled), 0) AS cancelled_sales,
      COUNT(*) FILTER (WHERE NOT is_cancelled) AS orders,
      COUNT(*) FILTER (WHERE is_cancelled) AS cancelled_orders,
      COUNT(*) AS total_orders
    FROM current_orders
    GROUP BY company_id
  ),
  previous_company_totals AS (
    SELECT
      company_id,
      COALESCE(SUM(amount) FILTER (WHERE NOT is_cancelled), 0) AS net_sales,
      COUNT(*) FILTER (WHERE NOT is_cancelled) AS orders
    FROM previous_orders
    GROUP BY company_id
  ),
  ranking AS (
    SELECT c.id, COALESCE(NULLIF(c.nombre_comercial, ''), NULLIF(c.nombre, ''), c.razon_social) AS name,
      COALESCE(t.net_sales, 0) AS net_sales,
      COALESCE(t.cancelled_sales, 0) AS cancelled_sales,
      COALESCE(t.orders, 0) AS orders,
      COALESCE(t.cancelled_orders, 0) AS cancelled_orders,
      COALESCE(t.total_orders, 0) AS total_orders,
      COALESCE(p.net_sales, 0) AS previous_net_sales,
      COALESCE(p.orders, 0) AS previous_orders,
      CASE WHEN COALESCE(t.orders, 0) > 0
        THEN COALESCE(t.net_sales, 0) / t.orders
        ELSE 0
      END AS average_ticket
    FROM companies c
    LEFT JOIN company_totals t ON t.company_id = c.id
    LEFT JOIN previous_company_totals p ON p.company_id = c.id
    WHERE c.activo IS NOT FALSE
      AND ($5::int IS NULL OR c.id = $5)
    ORDER BY net_sales DESC, name
  )
  SELECT
    (
      SELECT jsonb_build_object(
        'grossDemand', gross_demand,
        'netSales', net_sales,
        'cancelledSales', cancelled_sales,
        'orders', orders,
        'totalOrders', total_orders,
        'cancelledOrders', cancelled_orders,
        'averageTicket', CASE WHEN orders > 0 THEN net_sales / orders ELSE 0 END,
        'activeStores', active_stores
      ) FROM current_summary
    ) AS summary,
    (
      SELECT jsonb_build_object(
        'grossDemand', gross_demand,
        'netSales', net_sales,
        'cancelledSales', cancelled_sales,
        'orders', orders,
        'totalOrders', total_orders,
        'cancelledOrders', cancelled_orders,
        'averageTicket', CASE WHEN orders > 0 THEN net_sales / orders ELSE 0 END,
        'activeStores', active_stores
      ) FROM previous_summary
    ) AS previous_summary,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'day', day,
        'netSales', net_sales,
        'cancelledSales', cancelled_sales,
        'orders', orders
      ) ORDER BY day) FROM sales_daily
    ), '[]'::jsonb) AS sales_by_day,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'day', day, 'netSales', net_sales
      ) ORDER BY day) FROM previous_sales_daily
    ), '[]'::jsonb) AS previous_sales_by_day,
    COALESCE((
      SELECT jsonb_agg(to_jsonb(ranking) ORDER BY net_sales DESC, name) FROM ranking
    ), '[]'::jsonb) AS company_ranking,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', COALESCE(NULLIF(c.nombre_comercial, ''), NULLIF(c.nombre, ''), c.razon_social)
      ) ORDER BY COALESCE(NULLIF(c.nombre_comercial, ''), NULLIF(c.nombre, ''), c.razon_social))
      FROM companies c WHERE c.activo IS NOT FALSE
    ), '[]'::jsonb) AS companies,
    (SELECT MAX(synchronized_at) FROM falabella_orders) AS data_through
`;

export async function getDashboard(input = {}, db) {
  const target = await resolvePool(db);
  const filters = parseDashboardFilters(input);
  const cacheKey = JSON.stringify(filters);
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.value, cache: { hit: true, ttlSeconds: Math.ceil((cached.expiresAt - Date.now()) / 1000) } };
  }

  const query = await target.query(DASHBOARD_SQL, [
    filters.from,
    filters.to,
    filters.previousFrom,
    filters.previousTo,
    filters.companyId,
  ]);
  const row = query.rows[0] || {};
  const summary = normalizeSummary(row.summary);
  const previousSummary = normalizeSummary(row.previous_summary);
  const currentSalesByDay = fillDailySeries(
    filters.from,
    filters.to,
    normalizeRows(row.sales_by_day, ['netSales', 'cancelledSales', 'orders']),
    { netSales: 0, cancelledSales: 0, orders: 0 },
  );
  const previousSalesByDay = fillDailySeries(
    filters.previousFrom,
    filters.previousTo,
    normalizeRows(row.previous_sales_by_day, ['netSales']),
    { netSales: 0 },
  );
  const salesByDay = currentSalesByDay.map((item, index) => ({
    ...item,
    previousDay: previousSalesByDay[index]?.day || null,
    previousSales: previousSalesByDay[index]?.netSales || 0,
  }));
  const companyRanking = normalizeRows(row.company_ranking, [
    'net_sales', 'cancelled_sales', 'orders', 'cancelled_orders', 'total_orders',
    'previous_net_sales', 'previous_orders', 'average_ticket',
  ]).map((company) => ({
    id: company.id,
    name: company.name,
    netSales: company.net_sales,
    cancelledSales: company.cancelled_sales,
    orders: company.orders,
    cancelledOrders: company.cancelled_orders,
    totalOrders: company.total_orders,
    previousNetSales: company.previous_net_sales,
    previousOrders: company.previous_orders,
    averageTicket: company.average_ticket,
    salesShare: summary.netSales > 0 ? (company.net_sales / summary.netSales) * 100 : 0,
    salesChange: percentageDelta(company.net_sales, company.previous_net_sales),
    cancellationRate: company.total_orders > 0 ? (company.cancelled_orders / company.total_orders) * 100 : 0,
  }));
  const periodDays = diffDays(filters.from, filters.to) + 1;
  summary.dailyAverage = summary.netSales / periodDays;
  summary.cancellationRate = summary.totalOrders > 0
    ? (summary.cancelledOrders / summary.totalOrders) * 100
    : 0;
  previousSummary.dailyAverage = previousSummary.netSales / periodDays;
  previousSummary.cancellationRate = previousSummary.totalOrders > 0
    ? (previousSummary.cancelledOrders / previousSummary.totalOrders) * 100
    : 0;
  const value = {
    filters,
    summary,
    previousSummary,
    changes: {
      netSales: percentageDelta(summary.netSales, previousSummary.netSales),
      orders: percentageDelta(summary.orders, previousSummary.orders),
      averageTicket: percentageDelta(summary.averageTicket, previousSummary.averageTicket),
      dailyAverage: percentageDelta(summary.dailyAverage, previousSummary.dailyAverage),
      cancellationRate: percentageDelta(summary.cancellationRate, previousSummary.cancellationRate),
    },
    salesByDay,
    companyRanking,
    companies: row.companies || [],
    dataThrough: row.data_through ? new Date(row.data_through).toISOString() : null,
    generatedAt: new Date().toISOString(),
    cache: { hit: false, ttlSeconds: RESPONSE_CACHE_TTL_MS / 1000 },
  };
  responseCache.set(cacheKey, { value, expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS });
  return value;
}

export async function refreshDashboard(db) {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const target = await resolvePool(db);
    const client = await target.connect();
    let locked = false;
    try {
      const lock = await client.query(
        'select pg_try_advisory_lock($1, $2) as locked',
        [REFRESH_LOCK_NAMESPACE, REFRESH_LOCK_KEY],
      );
      locked = lock.rows[0]?.locked === true;
      if (!locked) return { refreshed: false, reason: 'already_running' };
      await client.query('refresh materialized view concurrently dashboard_daily_metrics');
      const state = await client.query(
        'update dashboard_refresh_state set refreshed_at=now() where id=1 returning refreshed_at',
      );
      responseCache.clear();
      return { refreshed: true, refreshedAt: state.rows[0]?.refreshed_at?.toISOString?.() || new Date().toISOString() };
    } finally {
      if (locked) {
        await client.query('select pg_advisory_unlock($1, $2)', [REFRESH_LOCK_NAMESPACE, REFRESH_LOCK_KEY]).catch(() => {});
      }
      client.release();
    }
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export async function refreshDashboardIfStale(db) {
  const target = await resolvePool(db);
  const state = await target.query('select refreshed_at from dashboard_refresh_state where id=1');
  const refreshedAt = state.rows[0]?.refreshed_at ? new Date(state.rows[0].refreshed_at).getTime() : 0;
  if (Date.now() - refreshedAt < MATERIALIZED_VIEW_TTL_MS) return { scheduled: false };
  void refreshDashboard(target).catch((error) => console.error('[DASHBOARD REFRESH]', error));
  return { scheduled: true };
}

export function startDashboardRefreshLoop(db) {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    void refreshDashboardIfStale(db).catch((error) => console.error('[DASHBOARD REFRESH LOOP]', error));
  }, 60_000);
  refreshTimer.unref?.();
  const initial = setTimeout(() => {
    void refreshDashboardIfStale(db).catch((error) => console.error('[DASHBOARD INITIAL REFRESH]', error));
  }, 5_000);
  initial.unref?.();
}

export function clearDashboardResponseCache() {
  responseCache.clear();
}
