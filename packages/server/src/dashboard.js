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
  const result = {
    grossSales: numeric(raw.grossSales),
    creditNotes: numeric(raw.creditNotes),
    netSales: numeric(raw.netSales),
    generatedDocuments: numeric(raw.generatedDocuments),
    acceptedDocuments: numeric(raw.acceptedDocuments),
    pendingDocuments: numeric(raw.pendingDocuments),
    rejectedDocuments: numeric(raw.rejectedDocuments),
    cancelledDocuments: numeric(raw.cancelledDocuments),
    boletas: numeric(raw.boletas),
    facturas: numeric(raw.facturas),
    averageTicket: numeric(raw.averageTicket),
    activeCompanies: numeric(raw.activeCompanies),
  };
  return result;
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
  current_metrics AS MATERIALIZED (
    SELECT *
    FROM dashboard_daily_metrics
    WHERE day BETWEEN $1::date AND $2::date
      AND ($5::int IS NULL OR company_id = $5)
      AND ($6::int IS NULL OR branch_id = $6)
  ),
  previous_metrics AS MATERIALIZED (
    SELECT *
    FROM dashboard_daily_metrics
    WHERE day BETWEEN $3::date AND $4::date
      AND ($5::int IS NULL OR company_id = $5)
      AND ($6::int IS NULL OR branch_id = $6)
  ),
  current_summary AS (
    SELECT
      COALESCE(SUM(total_amount) FILTER (
        WHERE document_type IN ('BOLETA', 'FACTURA') AND status = 'ACEPTADO'
      ), 0) AS gross_sales,
      COALESCE(SUM(total_amount) FILTER (
        WHERE document_type = 'NOTA_CREDITO' AND status = 'ACEPTADO'
      ), 0) AS credit_notes,
      COALESCE(SUM(document_count) FILTER (
        WHERE document_type IN ('BOLETA', 'FACTURA')
      ), 0) AS generated_documents,
      COALESCE(SUM(document_count) FILTER (
        WHERE document_type IN ('BOLETA', 'FACTURA') AND status = 'ACEPTADO'
      ), 0) AS accepted_documents,
      COALESCE(SUM(document_count) FILTER (
        WHERE document_type IN ('BOLETA', 'FACTURA') AND status = 'PENDIENTE'
      ), 0) AS pending_documents,
      COALESCE(SUM(document_count) FILTER (
        WHERE document_type IN ('BOLETA', 'FACTURA') AND status = 'RECHAZADO'
      ), 0) AS rejected_documents,
      COALESCE(SUM(document_count) FILTER (
        WHERE document_type IN ('BOLETA', 'FACTURA') AND status IN ('ANULADO', 'REEMPLAZADO')
      ), 0) AS cancelled_documents,
      COALESCE(SUM(document_count) FILTER (WHERE document_type = 'BOLETA'), 0) AS boletas,
      COALESCE(SUM(document_count) FILTER (WHERE document_type = 'FACTURA'), 0) AS facturas,
      COUNT(DISTINCT company_id) FILTER (
        WHERE document_type IN ('BOLETA', 'FACTURA') AND status = 'ACEPTADO'
      ) AS active_companies
    FROM current_metrics
  ),
  previous_summary AS (
    SELECT
      COALESCE(SUM(total_amount) FILTER (
        WHERE document_type IN ('BOLETA', 'FACTURA') AND status = 'ACEPTADO'
      ), 0) AS gross_sales,
      COALESCE(SUM(total_amount) FILTER (
        WHERE document_type = 'NOTA_CREDITO' AND status = 'ACEPTADO'
      ), 0) AS credit_notes,
      COALESCE(SUM(document_count) FILTER (
        WHERE document_type IN ('BOLETA', 'FACTURA')
      ), 0) AS generated_documents,
      COALESCE(SUM(document_count) FILTER (
        WHERE document_type IN ('BOLETA', 'FACTURA') AND status = 'ACEPTADO'
      ), 0) AS accepted_documents
    FROM previous_metrics
  ),
  sales_daily AS (
    SELECT day,
      COALESCE(SUM(total_amount) FILTER (
        WHERE document_type IN ('BOLETA', 'FACTURA') AND status = 'ACEPTADO'
      ), 0) AS gross_sales,
      COALESCE(SUM(total_amount) FILTER (
        WHERE document_type = 'NOTA_CREDITO' AND status = 'ACEPTADO'
      ), 0) AS credit_notes
    FROM current_metrics
    GROUP BY day
    ORDER BY day
  ),
  documents_daily AS (
    SELECT day,
      COALESCE(SUM(document_count) FILTER (WHERE document_type = 'BOLETA'), 0) AS boletas,
      COALESCE(SUM(document_count) FILTER (WHERE document_type = 'FACTURA'), 0) AS facturas
    FROM current_metrics
    GROUP BY day
    ORDER BY day
  ),
  statuses AS (
    SELECT
      CASE WHEN status IN ('ANULADO', 'REEMPLAZADO') THEN 'ANULADO' ELSE status END AS status,
      SUM(document_count) AS count
    FROM current_metrics
    WHERE document_type IN ('BOLETA', 'FACTURA')
    GROUP BY 1
    ORDER BY count DESC
  ),
  company_totals AS (
    SELECT company_id,
      COALESCE(SUM(total_amount) FILTER (
        WHERE document_type IN ('BOLETA', 'FACTURA') AND status = 'ACEPTADO'
      ), 0) AS gross_sales,
      COALESCE(SUM(total_amount) FILTER (
        WHERE document_type = 'NOTA_CREDITO' AND status = 'ACEPTADO'
      ), 0) AS credit_notes,
      COALESCE(SUM(document_count) FILTER (
        WHERE document_type IN ('BOLETA', 'FACTURA')
      ), 0) AS documents,
      COALESCE(SUM(document_count) FILTER (
        WHERE document_type IN ('BOLETA', 'FACTURA') AND status = 'ACEPTADO'
      ), 0) AS accepted_documents,
      COUNT(DISTINCT day) FILTER (
        WHERE document_type IN ('BOLETA', 'FACTURA') AND status = 'ACEPTADO'
      ) AS active_days
    FROM current_metrics
    GROUP BY company_id
  ),
  ranking AS (
    SELECT c.id, COALESCE(NULLIF(c.nombre_comercial, ''), NULLIF(c.nombre, ''), c.razon_social) AS name,
      COALESCE(t.gross_sales, 0) AS gross_sales,
      COALESCE(t.credit_notes, 0) AS credit_notes,
      COALESCE(t.gross_sales, 0) - COALESCE(t.credit_notes, 0) AS net_sales,
      COALESCE(t.documents, 0) AS documents,
      COALESCE(t.accepted_documents, 0) AS accepted_documents,
      COALESCE(t.active_days, 0) AS active_days,
      CASE WHEN COALESCE(t.accepted_documents, 0) > 0
        THEN COALESCE(t.gross_sales, 0) / t.accepted_documents
        ELSE 0
      END AS average_ticket
    FROM companies c
    LEFT JOIN company_totals t ON t.company_id = c.id
    WHERE c.activo IS NOT FALSE
      AND ($5::int IS NULL OR c.id = $5)
      AND ($6::int IS NULL OR EXISTS (
        SELECT 1 FROM branches b WHERE b.id = $6 AND b.company_id = c.id
      ))
    ORDER BY net_sales DESC, name
  )
  SELECT
    (
      SELECT jsonb_build_object(
        'grossSales', gross_sales,
        'creditNotes', credit_notes,
        'netSales', gross_sales - credit_notes,
        'generatedDocuments', generated_documents,
        'acceptedDocuments', accepted_documents,
        'pendingDocuments', pending_documents,
        'rejectedDocuments', rejected_documents,
        'cancelledDocuments', cancelled_documents,
        'boletas', boletas,
        'facturas', facturas,
        'averageTicket', CASE WHEN accepted_documents > 0 THEN gross_sales / accepted_documents ELSE 0 END,
        'activeCompanies', active_companies
      ) FROM current_summary
    ) AS summary,
    (
      SELECT jsonb_build_object(
        'grossSales', gross_sales,
        'creditNotes', credit_notes,
        'netSales', gross_sales - credit_notes,
        'generatedDocuments', generated_documents,
        'acceptedDocuments', accepted_documents,
        'averageTicket', CASE WHEN accepted_documents > 0 THEN gross_sales / accepted_documents ELSE 0 END
      ) FROM previous_summary
    ) AS previous_summary,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'day', day,
        'grossSales', gross_sales,
        'creditNotes', credit_notes,
        'netSales', gross_sales - credit_notes
      ) ORDER BY day) FROM sales_daily
    ), '[]'::jsonb) AS sales_by_day,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'day', day, 'boletas', boletas, 'facturas', facturas
      ) ORDER BY day) FROM documents_daily
    ), '[]'::jsonb) AS documents_by_day,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('status', status, 'count', count) ORDER BY count DESC)
      FROM statuses
    ), '[]'::jsonb) AS status_breakdown,
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
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', b.id, 'companyId', b.company_id, 'name', b.nombre
      ) ORDER BY b.nombre)
      FROM branches b WHERE b.activo IS NOT FALSE
    ), '[]'::jsonb) AS branches,
    (SELECT refreshed_at FROM dashboard_refresh_state WHERE id = 1) AS data_through
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
    filters.branchId,
  ]);
  const row = query.rows[0] || {};
  const summary = normalizeSummary(row.summary);
  const previousSummary = normalizeSummary(row.previous_summary);
  const salesByDay = fillDailySeries(
    filters.from,
    filters.to,
    normalizeRows(row.sales_by_day, ['grossSales', 'creditNotes', 'netSales']),
    { grossSales: 0, creditNotes: 0, netSales: 0 },
  );
  const documentsByDay = fillDailySeries(
    filters.from,
    filters.to,
    normalizeRows(row.documents_by_day, ['boletas', 'facturas']),
    { boletas: 0, facturas: 0 },
  );
  const companyRanking = normalizeRows(row.company_ranking, [
    'gross_sales', 'credit_notes', 'net_sales', 'documents', 'accepted_documents', 'active_days', 'average_ticket',
  ]).map((company) => ({
    id: company.id,
    name: company.name,
    grossSales: company.gross_sales,
    creditNotes: company.credit_notes,
    netSales: company.net_sales,
    documents: company.documents,
    acceptedDocuments: company.accepted_documents,
    activeDays: company.active_days,
    averageTicket: company.average_ticket,
  }));
  const statusBreakdown = normalizeRows(row.status_breakdown, ['count']);
  const value = {
    filters,
    summary,
    previousSummary,
    changes: {
      grossSales: percentageDelta(summary.grossSales, previousSummary.grossSales),
      netSales: percentageDelta(summary.netSales, previousSummary.netSales),
      generatedDocuments: percentageDelta(summary.generatedDocuments, previousSummary.generatedDocuments),
      averageTicket: percentageDelta(summary.averageTicket, previousSummary.averageTicket),
    },
    salesByDay,
    documentsByDay,
    documentMix: [
      { type: 'Boletas', value: summary.boletas },
      { type: 'Facturas', value: summary.facturas },
    ],
    statusBreakdown,
    companyRanking,
    companies: row.companies || [],
    branches: row.branches || [],
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
