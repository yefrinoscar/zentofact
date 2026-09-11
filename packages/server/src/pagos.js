import { createHash } from 'crypto';
import { classifyChargeKind, isPaidSettlementStatus, lineFingerprint, paidDateFromLine, parseSettlementCsv, rawValueByHeader } from './pagos-csv.js';
import { matchSettlementLines } from './pagos-match.js';
import { aggregateSettlementSales, attachDocumentsToSales, attachOrderShippingToSales, filterAggregatedSales, settlementDailySeries, settlementMonthOptions, slimSettlementSale, summarizeSettlementSales } from './pagos-sales.js';
import { attachInvoicesToSales, csvIsInvoiceReport, isInvoiceReportFilename, loadInvoiceRefsForOrders, uniqueSaleRefs } from './pagos-invoice.js';

const MAX_CSV_BYTES = 8 * 1024 * 1024;

let defaultPoolPromise;
let aggregatedSalesCache = null;

const SETTLEMENT_SNAPSHOT_LOCK = 746201;

export function clearSettlementSalesCache() {
  aggregatedSalesCache = null;
}

export function shouldCacheSettlementSales(db) {
  return db == null || db.useSettlementSalesCache === true;
}

async function resolvePool(db) {
  if (db) return db;
  defaultPoolPromise ||= import('@zentofact/core').then((core) => core.pool);
  return defaultPoolPromise;
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sha256(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function text(value, field, max = 180) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw httpError(`${field} es obligatorio.`);
  return normalized.slice(0, max);
}

function optionalPositiveInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw httpError('Empresa inválida.');
  return parsed;
}

function monthFilter(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (!/^\d{4}-\d{2}$/.test(value)) throw httpError('Mes inválido.');
  return value;
}

function money(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

async function upsertSaleSettlement(client, sale, status, importId) {
  const paid = status === 'paid';
  await client.query(
    `insert into sale_settlements (
       sale_source, sale_id, status, bruto, commission, other_fees, neto,
       match_method, import_id, paid_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (sale_source, sale_id) do update set
       status = case
         when sale_settlements.status = 'paid' or excluded.status = 'paid' then 'paid'
         else 'pending'
       end,
       bruto = excluded.bruto,
       commission = excluded.commission,
       other_fees = excluded.other_fees,
       neto = excluded.neto,
       match_method = excluded.match_method,
       import_id = excluded.import_id,
       paid_at = case
         when excluded.status = 'paid' then coalesce(sale_settlements.paid_at, excluded.paid_at)
         else sale_settlements.paid_at
       end,
       updated_at = now()
     where excluded.status = 'paid' or sale_settlements.status = 'pending'`,
    [
      sale.source,
      sale.id,
      status,
      money(sale.amounts.bruto),
      money(sale.amounts.commission),
      money(sale.amounts.other),
      money(sale.amounts.neto),
      sale.matchMethods[0] || 'order_id',
      importId,
      paid ? new Date() : null,
    ],
  );
}

export async function loadSaleIndex(db, companyId = null) {
  const target = await resolvePool(db);
  const query = await target.query(
    `select
       fo.id,
       fo.company_id,
       fo.order_id,
       fo.order_number,
       (fo.falabella_created_at at time zone 'America/Lima')::date::text as sale_date,
       coalesce(fo.grand_total, 0) as amount,
       array(
         select distinct lower(trim(sku))
         from (
           select oi.sku from orders o
             join order_items oi on oi.order_id = o.id
            where o.company_id = fo.company_id
              and (o.external_order_id = fo.order_id or o.external_order_number = fo.order_number)
           union all
           select oi.provider_sku from orders o
             join order_items oi on oi.order_id = o.id
            where o.company_id = fo.company_id
              and (o.external_order_id = fo.order_id or o.external_order_number = fo.order_number)
           union all
           select oi.main_sku from orders o
             join order_items oi on oi.order_id = o.id
            where o.company_id = fo.company_id
              and (o.external_order_id = fo.order_id or o.external_order_number = fo.order_number)
           union all
           select pl.seller_sku from orders o
             join order_items oi on oi.order_id = o.id
             join product_listings pl on pl.product_id = oi.product_id
              and pl.company_id = fo.company_id
              and pl.channel_code = 'falabella'
            where o.company_id = fo.company_id
              and (o.external_order_id = fo.order_id or o.external_order_number = fo.order_number)
         ) sku_source
         where sku is not null and trim(sku) <> ''
       ) as skus
     from falabella_orders fo
     join companies c on c.id = fo.company_id and c.activo is not false
     where ($1::int is null or fo.company_id = $1)`,
    [companyId],
  );
  return query.rows.map((row) => ({
    source: 'falabella_order',
    id: Number(row.id),
    companyId: Number(row.company_id),
    orderId: String(row.order_id || ''),
    orderNumber: String(row.order_number || ''),
    date: row.sale_date ? String(row.sale_date).slice(0, 10) : null,
    amount: money(row.amount),
    skus: row.skus || [],
  }));
}

function mapImport(row) {
  return {
    id: Number(row.id),
    filename: row.filename,
    fileSha256: row.file_sha256,
    companyId: row.company_id == null ? null : Number(row.company_id),
    importedAt: row.imported_at,
    importedBy: row.imported_by || null,
    lineCount: Number(row.line_count || 0),
    matchedCount: Number(row.matched_count || 0),
    unmatchedCount: Number(row.unmatched_count || 0),
    paidSalesCount: Number(row.paid_sales_count || 0),
    reused: Boolean(row.reused),
    replaced: Boolean(row.replaced),
  };
}

function mapLine(row) {
  return {
    id: Number(row.id),
    importId: Number(row.import_id),
    rowNumber: Number(row.row_number),
    status: row.match_status,
    method: row.match_method || null,
    reason: row.match_reason || null,
    orderId: row.order_ref || '',
    sku: row.sku || '',
    shopSku: row.shop_sku || rawValueByHeader(row.raw, (header) => (
      header === 'sku falabella' || header === 'shop sku' || header === 'shopsku'
    )),
    date: row.sale_date ? String(row.sale_date).slice(0, 10) : null,
    paidDate: paidDateFromLine({
      raw: row.raw || {},
      paymentStatus: row.payment_status || '',
      paid: isPaidSettlementStatus(row.payment_status),
    }) || (isPaidSettlementStatus(row.payment_status) && row.sale_date
      ? String(row.sale_date).slice(0, 10)
      : null),
    type: row.transaction_type || '',
    kind: row.kind || '',
    chargeKind: classifyChargeKind(row.transaction_type || ''),
    paid: isPaidSettlementStatus(row.payment_status),
    paymentStatus: row.payment_status || '',
    itemId: row.item_id || '',
    bruto: money(row.bruto),
    commission: money(row.commission),
    other: money(row.other_fees),
    neto: money(row.neto),
    saleOrderNumber: row.sale_order_number || null,
    productName: row.product_name || '',
    raw: row.raw || {},
    companyId: optionalId(row.match_company_id || row.import_company_id || row.company_id),
  };
}

function optionalId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function sellerIdFromRaw(raw) {
  return rawValueByHeader(raw, (header) => header === 'seller id' || header === 'sellerid');
}

async function attachCompaniesToLines(lines, db) {
  if ((lines || []).every((line) => line.companyId)) return lines;
  const needSku = new Set();
  const needSeller = new Set();
  for (const line of lines || []) {
    if (line.companyId) continue;
    const sku = String(line.sku || '').trim().toLowerCase();
    if (sku) needSku.add(sku);
    const seller = sellerIdFromRaw(line.raw).toLowerCase();
    if (seller) needSeller.add(seller);
  }
  const skuMap = new Map();
  const sellerMap = new Map();
  if (needSku.size) {
    const query = await db.query(
      `select lower(trim(seller_sku)) as sku, min(company_id)::int as company_id
         from product_listings
        where channel_code = 'falabella'
          and lower(trim(seller_sku)) = any($1::text[])
        group by 1
       having count(distinct company_id) = 1`,
      [[...needSku]],
    );
    for (const row of query.rows) skuMap.set(row.sku, Number(row.company_id));
  }
  if (needSeller.size) {
    const query = await db.query(
      `select id, lower(trim(falabella_api_user_id)) as seller
         from companies
        where activo is not false
          and nullif(trim(falabella_api_user_id), '') is not null
          and lower(trim(falabella_api_user_id)) = any($1::text[])`,
      [[...needSeller]],
    );
    for (const row of query.rows) sellerMap.set(row.seller, Number(row.id));
  }
  return (lines || []).map((line) => {
    if (line.companyId) return line;
    const sku = String(line.sku || '').trim().toLowerCase();
    const seller = sellerIdFromRaw(line.raw).toLowerCase();
    return {
      ...line,
      companyId: skuMap.get(sku) || sellerMap.get(seller) || null,
    };
  });
}

export async function listSettlementImports(filter = {}, db) {
  const target = await resolvePool(db);
  const limit = Math.min(Math.max(Number(filter.limit) || 20, 1), 100);
  const offset = Math.max(Number(filter.offset) || 0, 0);
  const query = await target.query(
    `select id, filename, file_sha256, company_id, imported_at, imported_by,
            line_count, matched_count, unmatched_count, paid_sales_count, false as reused,
            count(*) over()::int as total_count
       from settlement_imports
      order by imported_at desc, id desc
      limit $1 offset $2`,
    [limit, offset],
  );
  return {
    items: query.rows.map(mapImport),
    totalCount: Number(query.rows[0]?.total_count || 0),
    limit,
    offset,
  };
}

export async function listSettlementLines(filter = {}, db) {
  const target = await resolvePool(db);
  const status = String(filter.status || '').trim();
  if (status && !['matched', 'unmatched'].includes(status)) {
    throw httpError('Estado de cruce inválido.');
  }
  const importId = optionalPositiveInt(filter.importId);
  const limit = Math.min(Math.max(Number(filter.limit) || 50, 1), 200);
  const offset = Math.max(Number(filter.offset) || 0, 0);
  const values = [];
  const where = [];
  if (status) {
    values.push(status);
    where.push(`sl.match_status = $${values.length}`);
  }
  if (importId) {
    values.push(importId);
    where.push(`sl.import_id = $${values.length}`);
  }
  values.push(limit, offset);
  const query = await target.query(
    `select sl.id, sl.import_id, sl.row_number, sl.match_status, sl.match_method, sl.match_reason,
            sl.order_ref, sl.sku, sl.sale_date::text as sale_date, sl.transaction_type, sl.kind,
            sl.payment_status, sl.item_id,
            sl.bruto, sl.commission, sl.other_fees, sl.neto, sl.raw,
            fo.order_number as sale_order_number,
            count(*) over()::int as total_count
       from settlement_lines sl
       left join falabella_orders fo
         on sl.sale_source = 'falabella_order' and sl.sale_id = fo.id
      ${where.length ? `where ${where.join(' and ')}` : ''}
      order by sl.import_id desc, sl.row_number asc
      limit $${values.length - 1} offset $${values.length}`,
    values,
  );
  return {
    items: query.rows.map(mapLine),
    totalCount: Number(query.rows[0]?.total_count || 0),
    limit,
    offset,
  };
}

export const SETTLEMENT_SALES_LIST_MAX = 20000;
export const SETTLEMENT_SALES_PAGE_MAX = 200;
export const SETTLEMENT_SALES_PAGE_DEFAULT = 80;

export function settlementSalesLimit(raw) {
  if (raw === undefined || raw === null || raw === '') return SETTLEMENT_SALES_PAGE_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return SETTLEMENT_SALES_PAGE_DEFAULT;
  return Math.min(Math.floor(parsed), SETTLEMENT_SALES_PAGE_MAX);
}

const SETTLEMENT_SALES_LINE_SQL = `
       select sl.id, sl.import_id, sl.row_number, sl.match_status, sl.match_method, sl.match_reason,
              sl.order_ref, sl.sku, sl.sale_date::text as sale_date, sl.transaction_type, sl.kind,
              sl.payment_status, sl.item_id,
              sl.bruto, sl.commission, sl.other_fees, sl.neto,
              coalesce(sl.raw->>'Nombre del producto', sl.raw->>'Nombre del Producto') as product_name,
              coalesce(sl.raw->>'SKU Falabella', sl.raw->>'Shop SKU') as shop_sku,
              fo.order_number as sale_order_number,
              fo.company_id as match_company_id,
              si.company_id as import_company_id
         from settlement_lines sl
         left join falabella_orders fo
           on sl.sale_source = 'falabella_order' and sl.sale_id = fo.id
         left join settlement_imports si
           on si.id = sl.import_id`;

function stampKey(stamp) {
  return `${Number(stamp?.lineMaxId || 0)}:${Number(stamp?.importMaxId || 0)}:${Number(stamp?.importCount || 0)}`;
}

function persistableSale(sale) {
  const next = slimSettlementSale(sale);
  return {
    ...next,
    document: null,
    falabellaInvoice: null,
  };
}

async function readSettlementStamp(target) {
  const query = await target.query(`
    select
      (select coalesce(max(id), 0)::bigint from settlement_lines) as line_max_id,
      (select coalesce(max(id), 0)::bigint from settlement_imports) as import_max_id,
      (select count(*)::int from settlement_imports) as import_count
  `);
  const row = query.rows[0] || {};
  return {
    lineMaxId: Number(row.line_max_id || 0),
    importMaxId: Number(row.import_max_id || 0),
    importCount: Number(row.import_count || 0),
  };
}

async function readSettlementSnapshot(target, stamp) {
  try {
    const query = await target.query(
      `select sales
         from settlement_sales_snapshot
        where id = 1
          and line_max_id = $1
          and import_max_id = $2
          and import_count = $3`,
      [stamp.lineMaxId, stamp.importMaxId, stamp.importCount],
    );
    if (!query.rows[0]) return null;
    const sales = query.rows[0].sales;
    return Array.isArray(sales) ? sales : null;
  } catch {
    return null;
  }
}

async function writeSettlementSnapshot(target, stamp, sales) {
  try {
    await target.query(
      `insert into settlement_sales_snapshot (
         id, line_max_id, import_max_id, import_count, sale_count, sales, updated_at
       ) values (1, $1, $2, $3, $4, $5::jsonb, now())
       on conflict (id) do update set
         line_max_id = excluded.line_max_id,
         import_max_id = excluded.import_max_id,
         import_count = excluded.import_count,
         sale_count = excluded.sale_count,
         sales = excluded.sales,
         updated_at = now()`,
      [stamp.lineMaxId, stamp.importMaxId, stamp.importCount, sales.length, JSON.stringify(sales)],
    );
  } catch {
    // Listing still works from lines if the snapshot table is missing.
  }
}

async function withSettlementSnapshotLock(target, run) {
  try {
    await target.query('select pg_advisory_lock($1)', [SETTLEMENT_SNAPSHOT_LOCK]);
  } catch {
    return run();
  }
  try {
    return await run();
  } finally {
    try {
      await target.query('select pg_advisory_unlock($1)', [SETTLEMENT_SNAPSHOT_LOCK]);
    } catch {
      // The listing path must still return sales if unlock fails.
    }
  }
}

async function loadSalesFromLines(target, importId = null) {
  const values = [];
  const where = [];
  if (importId) {
    values.push(importId);
    where.push(`sl.import_id = $${values.length}`);
  }
  const query = await target.query(
    `${SETTLEMENT_SALES_LINE_SQL}
      ${where.length ? `where ${where.join(' and ')}` : ''}
      order by sl.import_id desc, sl.row_number asc`,
    values,
  );
  return attachSaleOrderShipping(
    aggregateSettlementSales(
      await attachCompaniesToLines(query.rows.map(mapLine), target),
    ),
    target,
  );
}

async function rememberSettlementSales(target, stamp, sales) {
  const persistable = sales.map(persistableSale);
  aggregatedSalesCache = { key: stampKey(stamp), sales: persistable };
  await writeSettlementSnapshot(target, stamp, persistable);
  return persistable;
}

async function loadAggregatedSettlementSales(target, { useCache, importId } = {}) {
  if (importId) return loadSalesFromLines(target, importId);
  if (!useCache) return loadSalesFromLines(target);
  const stamp = await readSettlementStamp(target);
  if (aggregatedSalesCache?.sales && aggregatedSalesCache.key === stampKey(stamp)) {
    return aggregatedSalesCache.sales;
  }
  const cached = await readSettlementSnapshot(target, stamp);
  if (cached != null) {
    aggregatedSalesCache = { key: stampKey(stamp), sales: cached };
    return cached;
  }
  return withSettlementSnapshotLock(target, async () => {
    const latest = await readSettlementStamp(target);
    if (aggregatedSalesCache?.sales && aggregatedSalesCache.key === stampKey(latest)) {
      return aggregatedSalesCache.sales;
    }
    const raced = await readSettlementSnapshot(target, latest);
    if (raced != null) {
      aggregatedSalesCache = { key: stampKey(latest), sales: raced };
      return raced;
    }
    const sales = await loadSalesFromLines(target);
    return rememberSettlementSales(target, latest, sales);
  });
}

async function refreshSettlementSalesSnapshot(db) {
  const target = await resolvePool(db);
  return withSettlementSnapshotLock(target, async () => {
    const stamp = await readSettlementStamp(target);
    const sales = await loadSalesFromLines(target);
    return rememberSettlementSales(target, stamp, sales);
  });
}

export async function listSettlementSales(filter = {}, db) {
  const target = await resolvePool(db);
  const importId = optionalPositiveInt(filter.importId);
  const paid = String(filter.paid || '').trim().toLowerCase();
  if (paid && ![
    'pagado',
    'no-pagado',
    'no_pagado',
    'devolucion-pagado',
    'devolucion_pagado',
    'devolucion-no-pagado',
    'devolucion_no_pagado',
  ].includes(paid)) {
    throw httpError('Estado de pago inválido.');
  }
  const search = String(filter.search || '').trim().toLowerCase();
  const orderMonth = monthFilter(filter.orderMonth);
  const paidMonth = monthFilter(filter.paidMonth);
  const companyId = optionalPositiveInt(filter.companyId);
  const limit = settlementSalesLimit(filter.limit);
  const offset = Math.max(Number(filter.offset) || 0, 0);
  let sales = await loadAggregatedSettlementSales(target, {
    useCache: shouldCacheSettlementSales(db),
    importId,
  });
  const months = settlementMonthOptions(sales);
  sales = filterAggregatedSales(sales, { paid, search, orderMonth, paidMonth, companyId });
  const summary = summarizeSettlementSales(sales);
  const days = settlementDailySeries(sales);
  const page = sales.slice(offset, offset + limit).map(slimSettlementSale);
  const withDocuments = await attachSaleDocuments(page, target);
  const withShipping = await attachSaleOrderShipping(withDocuments, target);
  const refs = await loadInvoiceRefsForOrders(withShipping.flatMap((sale) => uniqueSaleRefs(sale)), target);
  const items = attachInvoicesToSales(withShipping, refs, []).map(slimSettlementSale);
  return {
    items,
    summary,
    days,
    totalCount: sales.length,
    limit,
    offset,
    ...months,
  };
}

export async function loadSettlementSalesForOrders(orderIds, db) {
  const refs = [...new Set((orderIds || []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (!refs.length) return [];
  const target = await resolvePool(db);
  const query = await target.query(
    `select sl.id, sl.import_id, sl.row_number, sl.match_status, sl.match_method, sl.match_reason,
            sl.order_ref, sl.sku, sl.sale_date::text as sale_date, sl.transaction_type, sl.kind,
            sl.payment_status, sl.item_id,
            sl.bruto, sl.commission, sl.other_fees, sl.neto, sl.raw,
            fo.order_number as sale_order_number,
            fo.company_id as match_company_id,
            si.company_id as import_company_id
       from settlement_lines sl
       left join falabella_orders fo
         on sl.sale_source = 'falabella_order' and sl.sale_id = fo.id
       left join settlement_imports si
         on si.id = sl.import_id
      where sl.order_ref = any($1::text[])
         or fo.order_number = any($1::text[])
      order by sl.import_id desc, sl.row_number asc`,
    [refs],
  );
  return aggregateSettlementSales(
    await attachCompaniesToLines(query.rows.map(mapLine), target),
  );
}

async function attachSaleDocuments(sales, db) {
  const refs = [...new Set(sales.flatMap((sale) => (
    [sale.orderId, ...(sale.orderNumbers || [])]
  )).map((value) => String(value || '').trim()).filter(Boolean))];
  if (!refs.length) return attachDocumentsToSales(sales, []);
  const query = await db.query(
    `select 'boleta' as kind, order_number, numero_completo, estado_sunat
       from boletas
      where order_number = any($1::text[])
     union all
     select 'factura', order_number, numero_completo, estado_sunat
       from facturas
      where order_number = any($1::text[])`,
    [refs],
  );
  return attachDocumentsToSales(sales, query.rows.map((row) => ({
    kind: row.kind,
    orderNumber: row.order_number,
    number: row.numero_completo,
    status: row.estado_sunat,
  })));
}

function saleHasOrderShipping(sale) {
  return sale != null && Object.prototype.hasOwnProperty.call(sale, 'orderShipping');
}

async function attachSaleOrderShipping(sales, db) {
  const rows = sales || [];
  if (!rows.length) return attachOrderShippingToSales(rows, []);
  if (rows.every(saleHasOrderShipping)) return rows;
  const pending = rows.filter((sale) => !saleHasOrderShipping(sale));
  const refs = [...new Set(pending.flatMap((sale) => (
    [sale.orderId, ...(sale.orderNumbers || [])]
  )).map((value) => String(value || '').trim()).filter(Boolean))];
  if (!refs.length) {
    const empty = attachOrderShippingToSales(pending, []);
    if (empty.length === rows.length) return empty;
    const byId = new Map(empty.map((sale) => [sale.orderId, sale]));
    return rows.map((sale) => (saleHasOrderShipping(sale) ? sale : byId.get(sale.orderId) || { ...sale, orderShipping: null }));
  }
  const query = await db.query(
    `select o.external_order_id as order_id,
            o.external_order_number as order_number,
            o.shipping_amount
       from orders o
      where o.external_order_id = any($1::text[])
     union
     select o.external_order_id,
            o.external_order_number,
            o.shipping_amount
       from orders o
      where o.external_order_number = any($1::text[])`,
    [refs],
  );
  const attached = attachOrderShippingToSales(pending, query.rows.map((row) => ({
    orderId: row.order_id,
    orderNumber: row.order_number,
    shippingAmount: row.shipping_amount,
  })));
  if (attached.length === rows.length) return attached;
  const byId = new Map(attached.map((sale) => [sale.orderId, sale]));
  return rows.map((sale) => (saleHasOrderShipping(sale) ? sale : byId.get(sale.orderId) || { ...sale, orderShipping: null }));
}

export async function importSettlementCsv(input = {}, db) {
  const csv = String(input.csv || input.csvText || '');
  if (!csv.trim()) throw httpError('El CSV está vacío.');
  if (Buffer.byteLength(csv, 'utf8') > MAX_CSV_BYTES) {
    throw httpError('El CSV supera el tamaño máximo de 8 MB.');
  }
  const filename = text(input.filename || 'estado-de-cuenta.csv', 'Archivo', 180);
  if (csvIsInvoiceReport(csv) || isInvoiceReportFilename(filename)) {
    throw httpError('Este es un reporte de facturas. Usa Subir facturas.');
  }
  const companyId = optionalPositiveInt(input.companyId);
  const importedBy = input.importedBy ? String(input.importedBy) : null;
  const replace = Boolean(input.replace);
  const fileHash = sha256(csv);
  const target = await resolvePool(db);
  const existing = await target.query(
    `select id, filename, file_sha256, company_id, imported_at, imported_by,
            line_count, matched_count, unmatched_count, paid_sales_count, true as reused
       from settlement_imports
      where file_sha256 = $1
      order by id desc
      limit 1`,
    [fileHash],
  );
  if (existing.rows[0] && !replace) return mapImport(existing.rows[0]);

  const parsed = parseSettlementCsv(csv);
  const sales = await loadSaleIndex(target, companyId);
  const matched = matchSettlementLines(parsed.lines, sales);
  const stats = [
    parsed.lines.length,
    matched.results.filter((row) => row.status === 'matched').length,
    matched.results.filter((row) => row.status === 'unmatched').length,
    matched.paidSales.length,
  ];
  const client = await target.connect();
  try {
    await client.query('begin');
    let importRow;
    if (existing.rows[0]) {
      const existingId = Number(existing.rows[0].id);
      await client.query('delete from settlement_lines where import_id = $1', [existingId]);
      const updated = await client.query(
        `update settlement_imports
            set filename = $2,
                imported_by = $3,
                headers = $4::jsonb,
                line_count = $5,
                matched_count = $6,
                unmatched_count = $7,
                paid_sales_count = $8,
                imported_at = now()
          where id = $1
          returning id, filename, file_sha256, company_id, imported_at, imported_by,
                    line_count, matched_count, unmatched_count, paid_sales_count,
                    false as reused, true as replaced`,
        [existingId, filename, importedBy, JSON.stringify(parsed.binding.headers), ...stats],
      );
      importRow = updated.rows[0];
    } else {
      const inserted = await client.query(
        `insert into settlement_imports (
           filename, file_sha256, company_id, imported_by, headers,
           line_count, matched_count, unmatched_count, paid_sales_count
         ) values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)
         on conflict (file_sha256) do nothing
         returning id, filename, file_sha256, company_id, imported_at, imported_by,
                   line_count, matched_count, unmatched_count, paid_sales_count, false as reused`,
        [
          filename,
          fileHash,
          companyId,
          importedBy,
          JSON.stringify(parsed.binding.headers),
          ...stats,
        ],
      );
      if (!inserted.rows[0]) {
        await client.query('rollback');
        const race = await target.query(
          `select id, filename, file_sha256, company_id, imported_at, imported_by,
                  line_count, matched_count, unmatched_count, paid_sales_count, true as reused
             from settlement_imports where file_sha256 = $1 limit 1`,
          [fileHash],
        );
        return mapImport(race.rows[0]);
      }
      importRow = inserted.rows[0];
    }
    const importId = Number(importRow.id);
    for (const result of matched.results) {
      const fingerprint = lineFingerprint(result.line);
      await client.query(
        `insert into settlement_lines (
           import_id, row_number, fingerprint, order_ref, sku, sale_date, transaction_type,
           kind, bruto, commission, other_fees, neto, amount, raw,
           match_status, match_method, match_reason, sale_source, sale_id,
           payment_status, item_id
         ) values (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19,$20,$21
         )
         on conflict (fingerprint) do update set
           import_id = excluded.import_id,
           match_status = excluded.match_status,
           match_method = excluded.match_method,
           match_reason = excluded.match_reason,
           sale_source = excluded.sale_source,
           sale_id = excluded.sale_id,
           payment_status = excluded.payment_status,
           item_id = excluded.item_id`,
        [
          importId,
          result.line.rowNumber,
          fingerprint,
          result.line.orderId || '',
          result.line.sku || '',
          result.line.date,
          result.line.type || '',
          result.line.kind,
          money(result.line.bruto),
          money(result.line.commission),
          money(result.line.other),
          money(result.line.neto),
          result.line.amount,
          JSON.stringify(result.line.raw),
          result.status,
          result.method,
          result.reason || null,
          result.sale?.source || null,
          result.sale?.id || null,
          result.line.paymentStatus || '',
          result.line.itemId || '',
        ],
      );
    }
    for (const sale of matched.paidSales) {
      await upsertSaleSettlement(client, sale, 'paid', importId);
    }
    for (const sale of matched.pendingSales) {
      await upsertSaleSettlement(client, sale, 'pending', importId);
    }
    await client.query('commit');
    clearSettlementSalesCache();
    await refreshSettlementSalesSnapshot(target).catch(() => {});
    return mapImport(importRow);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
