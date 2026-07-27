const STAGES = new Set(['nuevo', 'por_emitir', 'en_proceso', 'atencion', 'completado']);

let corePromise;

function loadCore() {
  corePromise ||= import('@zentofact/core');
  return corePromise;
}

function positiveInt(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export function parseOrdersInboxFilters(input = {}) {
  const companyId = input.companyId === undefined || input.companyId === null || input.companyId === ''
    ? null
    : positiveInt(input.companyId, null, Number.MAX_SAFE_INTEGER);
  if (input.companyId !== undefined && input.companyId !== null && input.companyId !== '' && !companyId) {
    throw new Error('Tienda inválida.');
  }

  const stage = String(input.stage || '').trim().toLowerCase();
  if (stage && !STAGES.has(stage)) throw new Error('Etapa de pedido inválida.');

  const view = String(input.view || 'open').trim().toLowerCase();
  if (!['actionable', 'open', 'all'].includes(view)) throw new Error('Vista de pedidos inválida.');

  const days = input.days === undefined || input.days === '' ? 0 : Number(input.days);
  if (![0, 7, 30, 90].includes(days)) throw new Error('Periodo inválido.');

  return {
    companyId,
    stage: stage || null,
    view,
    days,
    search: String(input.search || '').trim().slice(0, 120),
    limit: positiveInt(input.limit, 10, 500),
    offset: Math.max(Number.isInteger(Number(input.offset)) ? Number(input.offset) : 0, 0),
  };
}

export function deliveryCycleWindows(nowInput = new Date()) {
  const now = new Date(nowInput);
  if (Number.isNaN(now.getTime())) throw new Error('Fecha inválida para métricas de despacho.');
  const limaClock = new Date(now.getTime() - 5 * 60 * 60_000);
  const cycleDay = new Date(Date.UTC(
    limaClock.getUTCFullYear(),
    limaClock.getUTCMonth(),
    limaClock.getUTCDate() - (limaClock.getUTCHours() < 17 ? 1 : 0),
  ));
  const cycleStart = new Date(Date.UTC(
    cycleDay.getUTCFullYear(), cycleDay.getUTCMonth(), cycleDay.getUTCDate(), 22,
  ));
  const noonBoundary = new Date(cycleStart.getTime() + 19 * 60 * 60_000);
  const cycleEnd = new Date(cycleStart.getTime() + 24 * 60 * 60_000);
  const stateFor = (from, to) => now < from ? 'upcoming' : now >= to ? 'completed' : 'active';
  return [
    { key: 'evening_to_noon', from: cycleStart.toISOString(), to: noonBoundary.toISOString(), state: stateFor(cycleStart, noonBoundary) },
    { key: 'noon_to_evening', from: noonBoundary.toISOString(), to: cycleEnd.toISOString(), state: stateFor(noonBoundary, cycleEnd) },
  ];
}

function durationMetric(row, prefix) {
  return {
    measured: Number(row?.[`${prefix}_measured`] || 0),
    averageMinutes: row?.[`${prefix}_avg`] == null ? null : Number(row[`${prefix}_avg`]),
    minMinutes: row?.[`${prefix}_min`] == null ? null : Number(row[`${prefix}_min`]),
    maxMinutes: row?.[`${prefix}_max`] == null ? null : Number(row[`${prefix}_max`]),
  };
}

function normalizeDeliveryMetrics(rows, windows) {
  const byWindow = new Map(rows.map((row) => [row.window_key, row]));
  return windows.map((window) => {
    const row = byWindow.get(window.key) || {};
    return {
      ...window,
      deliveries: Number(row.deliveries || 0),
      preparation: durationMetric(row, 'preparation'),
      handoff: durationMetric(row, 'handoff'),
      total: durationMetric(row, 'total'),
    };
  });
}

function normalizeDeliveryDays(rows) {
  const byDate = new Map();
  for (const row of rows) {
    if (!byDate.has(row.cycle_date)) byDate.set(row.cycle_date, { date: row.cycle_date, windows: [] });
    byDate.get(row.cycle_date).windows.push({
      key: row.window_key,
      deliveries: Number(row.deliveries || 0),
      preparation: durationMetric(row, 'preparation'),
      handoff: durationMetric(row, 'handoff'),
      total: durationMetric(row, 'total'),
    });
  }
  return [...byDate.values()];
}

const BASE_CTE = `
  with base_orders as (
    select
      fo.id,
      fo.company_id,
      coalesce(nullif(c.nombre, ''), nullif(c.nombre_comercial, ''), c.razon_social, 'Tienda') as company_name,
      c.ruc as company_ruc,
      fo.order_id,
      fo.order_number,
      fo.falabella_created_at,
      fo.falabella_updated_at,
      coalesce(fo.status, '') as falabella_status,
      fo.invoice_required,
      fo.grand_total,
      coalesce(nullif(fo.currency, ''), 'PEN') as currency,
      fo.first_seen_at,
      nullif(fo.raw_data->>'PromisedShippingTime', '') as promised_shipping_time,
      nullif(fo.raw_data->>'ShippingType', '') as shipping_type,
      concat_ws(' ', nullif(fo.raw_data->>'CustomerFirstName', ''), nullif(fo.raw_data->>'CustomerLastName', ''), nullif(fo.raw_data->>'CustomerLastName2', '')) as customer_name,
      nullif(fo.raw_data->>'ItemsCount', '') as items_count,
      doc.document_id,
      doc.document_kind,
      doc.document_number,
      doc.document_status,
      doc.document_date,
      case
        when lower(coalesce(fo.status, '')) ~ '(canceled|cancelled|cancelada|returned|devuelta|failed)'
          or upper(coalesce(doc.document_status, '')) = 'RECHAZADO' then 'atencion'
        when doc.document_id is null and lower(coalesce(fo.status, '')) ~ '(ready_to_ship|shipped|delivered)' then 'por_emitir'
        when doc.document_id is null then 'nuevo'
        when upper(coalesce(doc.document_status, '')) in ('ACEPTADO', 'ANULADO') then 'completado'
        else 'en_proceso'
      end as stage
    from falabella_orders fo
    join companies c on c.id = fo.company_id and c.activo is not false
    left join lateral (
      select document_id, document_kind, document_number, document_status, document_date
      from (
        select b.id as document_id, 'BOLETA'::text as document_kind, b.numero_completo as document_number,
          b.estado_sunat as document_status, b.fecha_emision as document_date, b.created_at
        from boletas b
        where b.company_id = fo.company_id and b.order_number = fo.order_number
        union all
        select f.id as document_id, 'FACTURA'::text as document_kind, f.numero_completo as document_number,
          f.estado_sunat as document_status, f.fecha_emision as document_date, f.created_at
        from facturas f
        where f.company_id = fo.company_id and f.order_number = fo.order_number
      ) documents
      order by created_at desc nulls last, document_id desc
      limit 1
    ) doc on true
    where ($1::int is null or fo.company_id = $1)
      and ($2::int = 0 or fo.falabella_created_at >= now() - make_interval(days => $2))
      and (
        $3::text = ''
        or fo.order_number ilike '%' || $3 || '%'
        or fo.order_id ilike '%' || $3 || '%'
        or coalesce(c.nombre, '') ilike '%' || $3 || '%'
        or coalesce(c.nombre_comercial, '') ilike '%' || $3 || '%'
        or c.razon_social ilike '%' || $3 || '%'
        or concat_ws(' ', fo.raw_data->>'CustomerFirstName', fo.raw_data->>'CustomerLastName', fo.raw_data->>'CustomerLastName2') ilike '%' || $3 || '%'
      )
  )
`;

function normalizeOrder(row) {
  return {
    id: Number(row.id),
    companyId: Number(row.company_id),
    companyName: row.company_name,
    companyRuc: row.company_ruc,
    orderId: row.order_id,
    orderNumber: row.order_number,
    createdAt: row.falabella_created_at,
    updatedAt: row.falabella_updated_at,
    firstSeenAt: row.first_seen_at,
    promisedShippingAt: falabellaUtcDate(row.promised_shipping_time),
    shippingType: row.shipping_type || '',
    falabellaStatus: row.falabella_status,
    invoiceRequired: row.invoice_required,
    total: Number(row.grand_total || 0),
    currency: row.currency || 'PEN',
    customerName: row.customer_name || '',
    itemsCount: row.items_count === null ? null : Number(row.items_count),
    sameOrderCount: Number(row.same_order_count || 1),
    sameOrderIndex: Number(row.same_order_index || 1),
    stage: row.stage,
    document: row.document_id ? {
      id: Number(row.document_id),
      kind: row.document_kind,
      number: row.document_number,
      status: row.document_status,
      date: row.document_date,
    } : null,
  };
}

export async function listOrdersInbox(input = {}, db) {
  const filters = parseOrdersInboxFilters(input);
  const target = db || (await loadCore()).pool;
  const deliveryWindows = deliveryCycleWindows();
  const baseValues = [filters.companyId, filters.days, filters.search];
  const listValues = [...baseValues, filters.view, filters.stage, filters.limit, filters.offset];

  const [ordersResult, summaryResult, syncResult, deliveryMetricsResult, deliveryHistoryResult] = await Promise.all([
    target.query(
      `${BASE_CTE}
       select *,
         count(*) over()::int as total_count,
         count(*) filter (where lower(falabella_status) ~ '(^|\\|)shipped(\\||$)') over()::int as shipped_count,
         count(*) over(partition by company_id, order_number)::int as same_order_count,
         row_number() over(
           partition by company_id, order_number
           order by falabella_created_at, id
         )::int as same_order_index
       from base_orders
       where (
         $4::text = 'all'
         or ($4::text = 'open' and stage <> 'completado')
          or ($4::text = 'actionable' and lower(falabella_status) ~ '(^|\\|)(pending|ready_to_ship|shipped)(\\||$)')
       )
         and ($5::text is null or stage = $5)
       order by falabella_created_at desc nulls last, id desc
       limit $6 offset $7`,
      listValues,
    ),
    target.query(
      `${BASE_CTE}
       select
         count(*)::int as total,
         count(*) filter (where stage <> 'completado')::int as open,
         count(*) filter (where stage = 'nuevo')::int as new,
         count(*) filter (where stage = 'por_emitir')::int as ready,
         count(*) filter (where stage = 'en_proceso')::int as processing,
         count(*) filter (where stage = 'atencion')::int as attention,
         count(*) filter (where stage = 'completado')::int as completed,
         coalesce(sum(grand_total) filter (where stage <> 'completado'), 0) as open_amount
       from base_orders`,
      baseValues,
    ),
    target.query(
      `select min(last_successful_sync_at) as last_synced_at
       from falabella_sync_state
       where ($1::int is null or company_id = $1)`,
      [filters.companyId],
    ),
    target.query(
       `select
         case when shipped_at_utc < $3::timestamptz then 'evening_to_noon' else 'noon_to_evening' end as window_key,
         count(*)::int as deliveries,
         count(*) filter (where ready_to_ship_at >= pending_at)::int as preparation_measured,
         round(avg(extract(epoch from (ready_to_ship_at - pending_at)) / 60)
           filter (where ready_to_ship_at >= pending_at))::int as preparation_avg,
         round(min(extract(epoch from (ready_to_ship_at - pending_at)) / 60)
           filter (where ready_to_ship_at >= pending_at))::int as preparation_min,
         round(max(extract(epoch from (ready_to_ship_at - pending_at)) / 60)
           filter (where ready_to_ship_at >= pending_at))::int as preparation_max,
         count(*) filter (where shipped_at >= ready_to_ship_at)::int as handoff_measured,
         round(avg(extract(epoch from (shipped_at - ready_to_ship_at)) / 60)
           filter (where shipped_at >= ready_to_ship_at))::int as handoff_avg,
         round(min(extract(epoch from (shipped_at - ready_to_ship_at)) / 60)
           filter (where shipped_at >= ready_to_ship_at))::int as handoff_min,
         round(max(extract(epoch from (shipped_at - ready_to_ship_at)) / 60)
           filter (where shipped_at >= ready_to_ship_at))::int as handoff_max,
         count(*) filter (where shipped_at >= pending_at)::int as total_measured,
         round(avg(extract(epoch from (shipped_at - pending_at)) / 60)
           filter (where shipped_at >= pending_at))::int as total_avg,
         round(min(extract(epoch from (shipped_at - pending_at)) / 60)
           filter (where shipped_at >= pending_at))::int as total_min,
         round(max(extract(epoch from (shipped_at - pending_at)) / 60)
           filter (where shipped_at >= pending_at))::int as total_max
       from (
         -- Falabella entrega estas horas sin zona; se almacenaron como UTC aunque corresponden a Lima.
         select *, shipped_at + interval '5 hours' as shipped_at_utc
         from falabella_order_lifecycle
       ) lifecycle
       where ($1::int is null or company_id=$1)
         and shipped_at_utc >= $2::timestamptz and shipped_at_utc < $4::timestamptz
       group by window_key`,
      [filters.companyId, deliveryWindows[0].from, deliveryWindows[0].to, deliveryWindows[1].to],
    ),
    target.query(
      `with lifecycle as (
         select *, shipped_at + interval '5 hours' as shipped_at_utc
         from falabella_order_lifecycle
         where shipped_at is not null
           and ($1::int is null or company_id=$1)
       ), localized as (
         select *, shipped_at_utc at time zone 'America/Lima' as shipped_at_lima
         from lifecycle
       ), bucketed as (
         select *,
           case when shipped_at_lima::time >= time '17:00'
             then shipped_at_lima::date + 1
             else shipped_at_lima::date
           end as cycle_date,
           case when shipped_at_lima::time >= time '17:00' or shipped_at_lima::time < time '12:00'
             then 'evening_to_noon'
             else 'noon_to_evening'
           end as window_key
         from localized
       ), clock as (
         select case when (now() at time zone 'America/Lima')::time >= time '17:00'
           then (now() at time zone 'America/Lima')::date + 1
           else (now() at time zone 'America/Lima')::date
         end as last_date
       ), bounds as (
         select
           date_trunc('week', last_date)::date as first_date,
           last_date
         from clock
       ), days as (
         select generate_series(first_date, last_date, interval '1 day')::date as cycle_date
         from bounds
       ), shift_windows as (
         select * from (values
           ('evening_to_noon', 1),
           ('noon_to_evening', 2)
         ) as shifts(window_key, sort_order)
       )
       select
         to_char(days.cycle_date, 'YYYY-MM-DD') as cycle_date,
         shift_windows.window_key,
         count(bucketed.order_id)::int as deliveries,
         count(bucketed.order_id) filter (where ready_to_ship_at >= pending_at)::int as preparation_measured,
         round(avg(extract(epoch from (ready_to_ship_at - pending_at)) / 60)
           filter (where ready_to_ship_at >= pending_at))::int as preparation_avg,
         round(min(extract(epoch from (ready_to_ship_at - pending_at)) / 60)
           filter (where ready_to_ship_at >= pending_at))::int as preparation_min,
         round(max(extract(epoch from (ready_to_ship_at - pending_at)) / 60)
           filter (where ready_to_ship_at >= pending_at))::int as preparation_max,
         count(bucketed.order_id) filter (where shipped_at >= ready_to_ship_at)::int as handoff_measured,
         round(avg(extract(epoch from (shipped_at - ready_to_ship_at)) / 60)
           filter (where shipped_at >= ready_to_ship_at))::int as handoff_avg,
         round(min(extract(epoch from (shipped_at - ready_to_ship_at)) / 60)
           filter (where shipped_at >= ready_to_ship_at))::int as handoff_min,
         round(max(extract(epoch from (shipped_at - ready_to_ship_at)) / 60)
           filter (where shipped_at >= ready_to_ship_at))::int as handoff_max,
         count(bucketed.order_id) filter (where shipped_at >= pending_at)::int as total_measured,
         round(avg(extract(epoch from (shipped_at - pending_at)) / 60)
           filter (where shipped_at >= pending_at))::int as total_avg,
         round(min(extract(epoch from (shipped_at - pending_at)) / 60)
           filter (where shipped_at >= pending_at))::int as total_min,
         round(max(extract(epoch from (shipped_at - pending_at)) / 60)
           filter (where shipped_at >= pending_at))::int as total_max
       from days
       cross join shift_windows
       left join bucketed
         on bucketed.cycle_date = days.cycle_date
         and bucketed.window_key = shift_windows.window_key
       group by days.cycle_date, shift_windows.window_key, shift_windows.sort_order
       order by days.cycle_date asc, shift_windows.sort_order asc`,
      [filters.companyId],
    ),
  ]);

  const companyResult = await target.query(
    `${BASE_CTE}
     select company_id, company_name,
       count(*)::int as total,
       count(*) filter (where stage <> 'completado')::int as open,
       coalesce(sum(grand_total) filter (where stage <> 'completado'), 0) as open_amount
     from base_orders
     group by company_id, company_name
     order by open desc, company_name asc`,
    baseValues,
  );

  const summary = summaryResult.rows[0] || {};
  return {
    orders: ordersResult.rows.map(normalizeOrder),
    totalCount: Number(ordersResult.rows[0]?.total_count || 0),
    shippedCount: Number(ordersResult.rows[0]?.shipped_count || 0),
    operationalCount: Math.max(
      Number(ordersResult.rows[0]?.total_count || 0) - Number(ordersResult.rows[0]?.shipped_count || 0),
      0,
    ),
    summary: {
      total: Number(summary.total || 0),
      open: Number(summary.open || 0),
      new: Number(summary.new || 0),
      ready: Number(summary.ready || 0),
      processing: Number(summary.processing || 0),
      attention: Number(summary.attention || 0),
      completed: Number(summary.completed || 0),
      openAmount: Number(summary.open_amount || 0),
      byCompany: companyResult.rows.map((row) => ({
        companyId: Number(row.company_id),
        companyName: row.company_name,
        total: Number(row.total || 0),
        open: Number(row.open || 0),
        openAmount: Number(row.open_amount || 0),
      })),
    },
    lastSyncedAt: syncResult.rows[0]?.last_synced_at || null,
    deliveryMetrics: {
      updatedAt: new Date().toISOString(),
      windows: normalizeDeliveryMetrics(deliveryMetricsResult.rows, deliveryWindows),
      days: normalizeDeliveryDays(deliveryHistoryResult.rows),
    },
    filters,
  };
}

export async function listFalabellaInboxCompanies(dependencies = {}) {
  const core = dependencies.listPublicCompanies ? null : await loadCore();
  const listPublicCompanies = dependencies.listPublicCompanies || core.listPublicCompanies;
  const companies = await listPublicCompanies();
  return companies
    .filter((company) => company.activo !== false && company.hasFalabellaCredentials)
    .map((company) => ({
      id: Number(company.id),
      name: String(company.nombre || company.nombreComercial || company.razonSocial || company.ruc || `Tienda ${company.id}`),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

function falabellaUtcDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const normalized = text.includes('T') ? text : text.replace(' ', 'T');
  const withZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`;
  const date = new Date(withZone);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function syncAllOrdersInbox(dependencies = {}) {
  const core = dependencies.listCompanies && dependencies.syncOrders ? null : await loadCore();
  const listCompanies = dependencies.listCompanies || core.listCompanies;
  const syncOrders = dependencies.syncOrders || (await import('./falabella-sync.js')).syncFalabellaOrders;
  const companies = (await listCompanies()).filter((company) => (
    company.activo && company.falabellaApiUserId?.trim() && company.falabellaApiKey?.trim()
  ));
  const results = [];
  for (const company of companies) {
    try {
      const result = await syncOrders(company.id);
      results.push({ companyId: company.id, companyName: company.nombre || company.razonSocial, ok: true, result });
    } catch (error) {
      results.push({ companyId: company.id, companyName: company.nombre || company.razonSocial, ok: false, error: String(error?.message || error) });
    }
  }
  return {
    stores: companies.length,
    successful: results.filter((entry) => entry.ok).length,
    failed: results.filter((entry) => !entry.ok).length,
    results,
  };
}
