import { createHash } from 'crypto';
import { lineFingerprint, normalizeHeader, parseSettlementCsv } from './pagos-csv.js';
import { matchSettlementLines } from './pagos-match.js';

const MAX_CSV_BYTES = 8 * 1024 * 1024;

let defaultPoolPromise;

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

function money(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
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
    date: row.sale_date ? String(row.sale_date).slice(0, 10) : null,
    type: row.transaction_type || '',
    kind: row.kind || '',
    paid: normalizeHeader(row.payment_status || '') !== 'no pagado',
    paymentStatus: row.payment_status || '',
    itemId: row.item_id || '',
    bruto: money(row.bruto),
    commission: money(row.commission),
    other: money(row.other_fees),
    neto: money(row.neto),
    saleOrderNumber: row.sale_order_number || null,
    raw: row.raw || {},
  };
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

export async function importSettlementCsv(input = {}, db) {
  const csv = String(input.csv || input.csvText || '');
  if (!csv.trim()) throw httpError('El CSV está vacío.');
  if (Buffer.byteLength(csv, 'utf8') > MAX_CSV_BYTES) {
    throw httpError('El CSV supera el tamaño máximo de 8 MB.');
  }
  const filename = text(input.filename || 'estado-de-cuenta.csv', 'Archivo', 180);
  const companyId = optionalPositiveInt(input.companyId);
  const importedBy = input.importedBy ? String(input.importedBy) : null;
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
  if (existing.rows[0]) return mapImport(existing.rows[0]);

  const parsed = parseSettlementCsv(csv);
  const sales = await loadSaleIndex(target, companyId);
  const matched = matchSettlementLines(parsed.lines, sales);
  const client = await target.connect();
  try {
    await client.query('begin');
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
        parsed.lines.length,
        matched.results.filter((row) => row.status === 'matched').length,
        matched.results.filter((row) => row.status === 'unmatched').length,
        matched.paidSales.length,
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
    const importId = Number(inserted.rows[0].id);
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
      await client.query(
        `insert into sale_settlements (
           sale_source, sale_id, status, bruto, commission, other_fees, neto,
           match_method, import_id, paid_at
         ) values ($1,$2,'paid',$3,$4,$5,$6,$7,$8,now())
         on conflict (sale_source, sale_id) do update set
           status = 'paid',
           bruto = excluded.bruto,
           commission = excluded.commission,
           other_fees = excluded.other_fees,
           neto = excluded.neto,
           match_method = excluded.match_method,
           import_id = excluded.import_id,
           paid_at = coalesce(sale_settlements.paid_at, excluded.paid_at),
           updated_at = now()`,
        [
          sale.source,
          sale.id,
          money(sale.amounts.bruto),
          money(sale.amounts.commission),
          money(sale.amounts.other),
          money(sale.amounts.neto),
          sale.matchMethods[0] || 'order_id',
          importId,
        ],
      );
    }
    await client.query('commit');
    return mapImport(inserted.rows[0]);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
