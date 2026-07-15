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
  if (!['open', 'all'].includes(view)) throw new Error('Vista de pedidos inválida.');

  const days = input.days === undefined || input.days === '' ? 0 : Number(input.days);
  if (![0, 7, 30, 90].includes(days)) throw new Error('Periodo inválido.');

  return {
    companyId,
    stage: stage || null,
    view,
    days,
    search: String(input.search || '').trim().slice(0, 120),
    limit: positiveInt(input.limit, 10, 100),
    offset: Math.max(Number.isInteger(Number(input.offset)) ? Number(input.offset) : 0, 0),
  };
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
    falabellaStatus: row.falabella_status,
    invoiceRequired: row.invoice_required,
    total: Number(row.grand_total || 0),
    currency: row.currency || 'PEN',
    customerName: row.customer_name || '',
    itemsCount: row.items_count === null ? null : Number(row.items_count),
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
  const baseValues = [filters.companyId, filters.days, filters.search];
  const listValues = [...baseValues, filters.view, filters.stage, filters.limit, filters.offset];

  const [ordersResult, summaryResult, syncResult] = await Promise.all([
    target.query(
      `${BASE_CTE}
       select *, count(*) over()::int as total_count
       from base_orders
       where ($4::text = 'all' or stage <> 'completado')
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
      `select max(last_successful_sync_at) as last_synced_at
       from falabella_sync_state
       where ($1::int is null or company_id = $1)`,
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
    filters,
  };
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
