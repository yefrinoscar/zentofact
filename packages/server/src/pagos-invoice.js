import { createHash } from 'crypto';
import {
  normalizeHeader,
  parseCsvRows,
  parseDateKey,
  parseMoney,
  repairSettlementText,
} from './pagos-csv.js';

const MAX_CSV_BYTES = 8 * 1024 * 1024;
const CONCEPT_ORDER = ['commission', 'logistics', 'buyer_shipping', 'ads', 'other'];

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

function money(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function text(value, field, max = 180) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw httpError(`${field} es obligatorio.`);
  return normalized.slice(0, max);
}

function joinedHeaders(row) {
  return (row || []).map((cell) => String(cell ?? '')).join(',');
}

export function isInvoiceReportFilename(name) {
  return /^invoicereport[_-]/i.test(String(name || '').trim());
}

export function headerLooksLikeInvoiceReport(text) {
  const normalized = normalizeHeader(text);
  return normalized.includes('numero de documento')
    && (
      normalized.includes('descripcion factura')
      || normalized.includes('tipo de documento')
      || normalized.includes('monto con iva')
    );
}

export function csvIsInvoiceReport(csv) {
  const source = String(csv || '');
  if (headerLooksLikeInvoiceReport(source.slice(0, 4000))) return true;
  try {
    const rows = parseCsvRows(source);
    return rows.some((row) => headerLooksLikeInvoiceReport(joinedHeaders(row)));
  } catch {
    return false;
  }
}

export function classifyInvoiceKind(value) {
  const normalized = normalizeHeader(value);
  if (normalized.includes('nota')) return 'nota_credito';
  return 'factura';
}

export function classifyInvoiceConcept(description, transactionType = '') {
  const normalized = normalizeHeader(
    `${repairSettlementText(description)} ${repairSettlementText(transactionType)}`,
  );
  if (normalized.includes('patrocin') || normalized.includes('publicidad')) return 'ads';
  if (
    normalized.includes('a cargo de cliente')
    || normalized.includes('envio comprador')
    || normalized.includes('reversa de pago de env')
  ) {
    return 'buyer_shipping';
  }
  if (normalized.includes('cofinanciamiento') || normalized.includes('logistic')) return 'logistics';
  if (normalized.includes('comisi')) return 'commission';
  return 'other';
}

const COLUMN_MATCHERS = {
  documentNumber: (n) => n.includes('numero de documento') || n === 'n de documento',
  documentKind: (n) => n === 'tipo de documento' || n.includes('tipo de documento'),
  transactedAt: (n) => n.includes('fecha de transacci'),
  description: (n) => n.includes('descripcion factura'),
  transactionType: (n) => n.includes('tipo de transacci'),
  productName: (n) => n.includes('nombre del producto'),
  sellerSku: (n) => n === 'sku vendedor' || n === 'sku del vendedor',
  falabellaSku: (n) => n === 'sku falabella',
  net: (n) => n === 'monto sin iva' || n.includes('monto sin iva'),
  igv: (n) => n === 'iva',
  gross: (n) => n === 'monto con iva',
  currency: (n) => n === 'divisa' || n === 'moneda',
  statementNumber: (n) => n.includes('estado de cuenta'),
  orderNumber: (n) => n.includes('n de orden') || n.includes('numero de orden') || n.includes('de pedido'),
  paidReference: (n) => n.includes('referencia de pago'),
  falabellaId: (n) => n === 'falabella id' || n === 'falabella-id',
  sellerId: (n) => n === 'seller id' || n === 'sellerid',
};

function pickHeader(headers, role, used) {
  const match = COLUMN_MATCHERS[role];
  for (const header of headers) {
    if (used.has(header.original)) continue;
    if (match(header.normalized)) {
      used.add(header.original);
      return header.original;
    }
  }
  return null;
}

export function bindInvoiceHeaders(headerRow) {
  const headers = (headerRow || []).map((original, index) => ({
    original: String(original || '').trim(),
    normalized: normalizeHeader(original),
    index,
  })).filter((header) => header.original);
  if (!headers.length) throw httpError('El Excel no tiene cabecera.');
  const used = new Set();
  const columns = {};
  for (const role of Object.keys(COLUMN_MATCHERS)) {
    columns[role] = pickHeader(headers, role, used);
  }
  if (!columns.documentNumber || !(columns.gross || columns.net)) {
    throw httpError('No reconocimos el reporte de facturas de Falabella.');
  }
  return {
    columns,
    headers: headers.map((header) => header.original),
  };
}

function cell(row, headers, column) {
  if (!column) return '';
  const index = headers.indexOf(column);
  if (index < 0) return '';
  return String(row[index] ?? '').trim();
}

function parseTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = new Date(raw.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function periodFromFilename(name) {
  const match = String(name || '').match(/(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})/);
  if (!match) return { from: null, to: null };
  return { from: match[1], to: match[2] };
}

export function parseInvoiceReportCsv(csv) {
  const rows = parseCsvRows(String(csv || ''));
  const headerIndex = rows.findIndex((row) => headerLooksLikeInvoiceReport(joinedHeaders(row)));
  if (headerIndex < 0) throw httpError('No reconocimos el reporte de facturas de Falabella.');
  const headerRow = rows[headerIndex];
  const binding = bindInvoiceHeaders(headerRow);
  const { columns } = binding;
  const lines = [];
  rows.slice(headerIndex + 1).forEach((row, index) => {
    const documentNumber = cell(row, headerRow, columns.documentNumber);
    if (!documentNumber) return;
    const net = parseMoney(cell(row, headerRow, columns.net));
    const igv = parseMoney(cell(row, headerRow, columns.igv));
    const gross = parseMoney(cell(row, headerRow, columns.gross));
    const transactedAt = cell(row, headerRow, columns.transactedAt);
    const description = repairSettlementText(cell(row, headerRow, columns.description));
    const transactionType = repairSettlementText(cell(row, headerRow, columns.transactionType));
    lines.push({
      rowNumber: headerIndex + index + 2,
      documentNumber,
      documentKind: classifyInvoiceKind(cell(row, headerRow, columns.documentKind)),
      transactedAt: parseTimestamp(transactedAt),
      transactedOn: parseDateKey(transactedAt),
      description,
      transactionType,
      productName: repairSettlementText(cell(row, headerRow, columns.productName)),
      sellerSku: cell(row, headerRow, columns.sellerSku),
      falabellaSku: cell(row, headerRow, columns.falabellaSku),
      net: money(net),
      igv: money(igv),
      gross: money(gross ?? ((net || 0) + (igv || 0))),
      currency: cell(row, headerRow, columns.currency) || 'PEN',
      statementNumber: cell(row, headerRow, columns.statementNumber),
      orderNumber: cell(row, headerRow, columns.orderNumber),
      paidReference: cell(row, headerRow, columns.paidReference),
      falabellaId: cell(row, headerRow, columns.falabellaId),
      sellerId: cell(row, headerRow, columns.sellerId),
      concept: classifyInvoiceConcept(description, transactionType),
    });
  });
  if (!lines.length) throw httpError('El reporte de facturas no trae líneas.');
  return { binding, lines, documents: groupInvoiceDocuments(lines) };
}

function collectDates(lines) {
  const days = [...new Set((lines || []).map((line) => line.transactedOn).filter(Boolean))].sort();
  return { from: days[0] || null, to: days[days.length - 1] || null };
}

export function summarizeInvoiceConcepts(lines) {
  const buckets = new Map();
  for (const line of lines || []) {
    const key = line.concept || 'other';
    const current = buckets.get(key) || {
      key,
      count: 0,
      net: 0,
      igv: 0,
      gross: 0,
    };
    current.count += 1;
    current.net = money(current.net + Number(line.net || 0));
    current.igv = money(current.igv + Number(line.igv || 0));
    current.gross = money(current.gross + Number(line.gross || 0));
    buckets.set(key, current);
  }
  return CONCEPT_ORDER
    .map((key) => buckets.get(key))
    .filter(Boolean);
}

export function groupInvoiceDocuments(lines) {
  const groups = new Map();
  for (const line of lines || []) {
    const key = `${line.documentNumber}|${line.documentKind}`;
    const current = groups.get(key) || {
      number: line.documentNumber,
      kind: line.documentKind,
      currency: line.currency || 'PEN',
      sellerId: line.sellerId || '',
      lines: [],
    };
    current.lines.push(line);
    if (!current.sellerId && line.sellerId) current.sellerId = line.sellerId;
    if (!current.currency && line.currency) current.currency = line.currency;
    groups.set(key, current);
  }
  return [...groups.values()].map((document) => {
    const period = collectDates(document.lines);
    const concepts = summarizeInvoiceConcepts(document.lines);
    const net = money(document.lines.reduce((sum, line) => sum + Number(line.net || 0), 0));
    const igv = money(document.lines.reduce((sum, line) => sum + Number(line.igv || 0), 0));
    const gross = money(document.lines.reduce((sum, line) => sum + Number(line.gross || 0), 0));
    const statements = [...new Set(document.lines.map((line) => line.statementNumber).filter(Boolean))];
    const paymentRefs = [...new Set(document.lines.map((line) => line.paidReference).filter(Boolean))];
    return {
      number: document.number,
      kind: document.kind,
      currency: document.currency || 'PEN',
      sellerId: document.sellerId || '',
      issuedOn: period.to,
      periodFrom: period.from,
      periodTo: period.to,
      net,
      igv,
      gross,
      lineCount: document.lines.length,
      statements,
      paymentRefs,
      concepts,
      lines: document.lines,
    };
  });
}

export function attachInvoicesToSales(sales, invoices, charges) {
  const byRef = new Map();
  const chargeMap = charges instanceof Map ? charges : foldInvoiceCharges(charges);
  for (const invoice of invoices || []) {
    const key = String(invoice.orderNumber || '').trim();
    if (!key) continue;
    const list = byRef.get(key) || [];
    if (!list.some((item) => item.id === invoice.id)) {
      list.push({
        id: Number(invoice.id),
        number: invoice.number || '',
        kind: invoice.kind || 'factura',
      });
    }
    byRef.set(key, list);
  }
  return (sales || []).map((sale) => {
    const refs = [sale.orderId, ...(sale.orderNumbers || [])]
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    const all = [];
    const seen = new Set();
    for (const ref of refs) {
      for (const invoice of byRef.get(ref) || []) {
        if (seen.has(invoice.id)) continue;
        seen.add(invoice.id);
        all.push(invoice);
      }
    }
    const primary = all.find((item) => item.kind === 'factura') || all[0] || null;
    const invoiceCharges = mergeInvoiceCharges(refs, chargeMap);
    return { ...sale, falabellaInvoice: primary, falabellaInvoices: all, invoiceCharges };
  });
}

export function cobroFromSigned(signed) {
  return money(-Number(signed || 0));
}

export function foldInvoiceCharges(rows) {
  const byOrder = new Map();
  for (const row of rows || []) {
    const order = String(row.orderNumber || row.order_number || '').trim();
    if (!order) continue;
    const concept = row.concept || 'other';
    const current = byOrder.get(order) || {};
    const bucket = current[concept] || { net: 0, igv: 0, gross: 0 };
    bucket.net = money(bucket.net + cobroFromSigned(row.net));
    bucket.igv = money(bucket.igv + cobroFromSigned(row.igv));
    bucket.gross = money(bucket.gross + cobroFromSigned(row.gross));
    current[concept] = bucket;
    byOrder.set(order, current);
  }
  return byOrder;
}

function mergeInvoiceCharges(refs, chargeMap) {
  const merged = {};
  for (const ref of refs) {
    const charges = chargeMap.get(ref);
    if (!charges) continue;
    for (const [concept, bucket] of Object.entries(charges)) {
      const current = merged[concept] || { net: 0, igv: 0, gross: 0 };
      current.net = money(current.net + Number(bucket.net || 0));
      current.igv = money(current.igv + Number(bucket.igv || 0));
      current.gross = money(current.gross + Number(bucket.gross || 0));
      merged[concept] = current;
    }
  }
  return Object.keys(merged).length ? merged : null;
}

function mapImport(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    filename: row.filename,
    fileSha256: row.file_sha256,
    sellerId: row.seller_id || '',
    periodFrom: row.period_from || null,
    periodTo: row.period_to || null,
    documentCount: Number(row.document_count || 0),
    lineCount: Number(row.line_count || 0),
    importedAt: row.imported_at || null,
    importedBy: row.imported_by || null,
    reused: Boolean(row.reused),
    replaced: Boolean(row.replaced),
  };
}

function mapDocument(row) {
  return {
    id: Number(row.id),
    importId: Number(row.import_id),
    number: row.document_number,
    kind: row.document_kind,
    currency: row.currency || 'PEN',
    sellerId: row.seller_id || '',
    issuedOn: row.issued_on || null,
    periodFrom: row.period_from || null,
    periodTo: row.period_to || null,
    net: money(row.net),
    igv: money(row.igv),
    gross: money(row.gross),
    lineCount: Number(row.line_count || 0),
    filename: row.filename || '',
    importedAt: row.imported_at || null,
  };
}

function mapLine(row) {
  return {
    id: Number(row.id),
    documentId: Number(row.document_id),
    rowNumber: Number(row.row_number),
    orderNumber: row.order_number || '',
    productName: row.product_name || '',
    sellerSku: row.seller_sku || '',
    falabellaSku: row.falabella_sku || '',
    description: row.description || '',
    transactionType: row.transaction_type || '',
    concept: row.concept || 'other',
    net: money(row.net),
    igv: money(row.igv),
    gross: money(row.gross),
    statementNumber: row.statement_number || '',
    paidReference: row.paid_reference || '',
    transactedAt: row.transacted_at || null,
  };
}

export async function importInvoiceReportCsv(input = {}, db) {
  const csv = String(input.csv || input.csvText || '');
  if (!csv.trim()) throw httpError('El Excel está vacío.');
  if (Buffer.byteLength(csv, 'utf8') > MAX_CSV_BYTES) {
    throw httpError('El archivo supera el tamaño máximo de 8 MB.');
  }
  const filename = text(input.filename || 'InvoiceReport.xlsx', 'Archivo', 180);
  if (!csvIsInvoiceReport(csv) && !isInvoiceReportFilename(filename)) {
    throw httpError('Este es el estado de cuenta. Usa Subir archivo.');
  }
  const importedBy = input.importedBy ? String(input.importedBy) : null;
  const replace = Boolean(input.replace);
  const fileHash = sha256(csv);
  const parsed = parseInvoiceReportCsv(csv);
  const filePeriod = periodFromFilename(filename);
  const sellerId = parsed.documents.find((document) => document.sellerId)?.sellerId || '';
  const periodFrom = filePeriod.from || parsed.documents.map((document) => document.periodFrom).filter(Boolean).sort()[0] || null;
  const periodTo = filePeriod.to || parsed.documents.map((document) => document.periodTo).filter(Boolean).sort().at(-1) || null;
  const target = await resolvePool(db);
  const existing = await target.query(
    `select id, filename, file_sha256, seller_id, period_from, period_to,
            document_count, line_count, imported_at, imported_by, true as reused
       from falabella_invoice_imports
      where file_sha256 = $1
      order by id desc
      limit 1`,
    [fileHash],
  );
  if (existing.rows[0] && !replace) {
    const reused = mapImport(existing.rows[0]);
    const documents = await listInvoiceDocuments({ importId: reused.id }, target);
    return { ...reused, documents: documents.items };
  }

  const client = await target.connect();
  try {
    await client.query('begin');
    let importRow;
    if (existing.rows[0]) {
      const existingId = Number(existing.rows[0].id);
      await client.query('delete from falabella_invoice_documents where import_id = $1', [existingId]);
      const updated = await client.query(
        `update falabella_invoice_imports
            set filename = $2,
                seller_id = $3,
                period_from = $4,
                period_to = $5,
                document_count = $6,
                line_count = $7,
                imported_by = $8,
                imported_at = now()
          where id = $1
          returning id, filename, file_sha256, seller_id, period_from, period_to,
                    document_count, line_count, imported_at, imported_by,
                    false as reused, true as replaced`,
        [
          existingId,
          filename,
          sellerId,
          periodFrom,
          periodTo,
          parsed.documents.length,
          parsed.lines.length,
          importedBy,
        ],
      );
      importRow = updated.rows[0];
    } else {
      const inserted = await client.query(
        `insert into falabella_invoice_imports (
           filename, file_sha256, seller_id, period_from, period_to,
           document_count, line_count, imported_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (file_sha256) do nothing
         returning id, filename, file_sha256, seller_id, period_from, period_to,
                   document_count, line_count, imported_at, imported_by, false as reused`,
        [
          filename,
          fileHash,
          sellerId,
          periodFrom,
          periodTo,
          parsed.documents.length,
          parsed.lines.length,
          importedBy,
        ],
      );
      if (!inserted.rows[0]) {
        await client.query('rollback');
        const race = await target.query(
          `select id, filename, file_sha256, seller_id, period_from, period_to,
                  document_count, line_count, imported_at, imported_by, true as reused
             from falabella_invoice_imports where file_sha256 = $1 limit 1`,
          [fileHash],
        );
        const reused = mapImport(race.rows[0]);
        const documents = await listInvoiceDocuments({ importId: reused.id }, target);
        return { ...reused, documents: documents.items };
      }
      importRow = inserted.rows[0];
    }
    const importId = Number(importRow.id);
    const stored = [];
    for (const document of parsed.documents) {
      const inserted = await client.query(
        `insert into falabella_invoice_documents (
           import_id, document_number, document_kind, currency, seller_id,
           issued_on, period_from, period_to, net, igv, gross, line_count
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         returning id, import_id, document_number, document_kind, currency, seller_id,
                   issued_on, period_from, period_to, net, igv, gross, line_count`,
        [
          importId,
          document.number,
          document.kind,
          document.currency,
          document.sellerId,
          document.issuedOn,
          document.periodFrom,
          document.periodTo,
          document.net,
          document.igv,
          document.gross,
          document.lineCount,
        ],
      );
      const saved = inserted.rows[0];
      const documentId = Number(saved.id);
      for (const line of document.lines) {
        await client.query(
          `insert into falabella_invoice_lines (
             document_id, import_id, row_number, order_number, product_name, seller_sku,
             falabella_sku, description, transaction_type, concept, net, igv, gross,
             statement_number, paid_reference, transacted_at
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            documentId,
            importId,
            line.rowNumber,
            line.orderNumber,
            line.productName,
            line.sellerSku,
            line.falabellaSku,
            line.description,
            line.transactionType,
            line.concept,
            line.net,
            line.igv,
            line.gross,
            line.statementNumber,
            line.paidReference,
            line.transactedAt,
          ],
        );
      }
      stored.push(mapDocument(saved));
    }
    await client.query('commit');
    return { ...mapImport(importRow), documents: stored };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function listInvoiceDocuments(filter = {}, db) {
  const target = await resolvePool(db);
  const limit = Math.min(Math.max(Number(filter.limit) || 50, 1), 100);
  const offset = Math.max(Number(filter.offset) || 0, 0);
  const importId = Number(filter.importId);
  const values = [];
  const where = [];
  if (Number.isInteger(importId) && importId > 0) {
    values.push(importId);
    where.push(`d.import_id = $${values.length}`);
  }
  values.push(limit, offset);
  const query = await target.query(
    `select latest.*, count(*) over()::int as total_count
       from (
         select distinct on (d.document_number, d.document_kind)
                d.id, d.import_id, d.document_number, d.document_kind, d.currency, d.seller_id,
                d.issued_on, d.period_from, d.period_to, d.net, d.igv, d.gross, d.line_count,
                i.filename, i.imported_at
           from falabella_invoice_documents d
           join falabella_invoice_imports i on i.id = d.import_id
          ${where.length ? `where ${where.join(' and ')}` : ''}
          order by d.document_number, d.document_kind, d.id desc
       ) latest
      order by latest.imported_at desc,
               case when latest.document_kind = 'factura' then 0 else 1 end,
               latest.id desc
      limit $${values.length - 1} offset $${values.length}`,
    values,
  );
  return {
    items: query.rows.map(mapDocument),
    totalCount: Number(query.rows[0]?.total_count || query.rows.length),
    limit,
    offset,
  };
}

export async function getInvoiceDocument(id, db) {
  const documentId = Number(id);
  if (!Number.isInteger(documentId) || documentId <= 0) throw httpError('Factura inválida.');
  const target = await resolvePool(db);
  const query = await target.query(
    `select d.id, d.import_id, d.document_number, d.document_kind, d.currency, d.seller_id,
            d.issued_on, d.period_from, d.period_to, d.net, d.igv, d.gross, d.line_count,
            i.filename, i.imported_at, i.seller_id as import_seller_id
       from falabella_invoice_documents d
       join falabella_invoice_imports i on i.id = d.import_id
      where d.id = $1`,
    [documentId],
  );
  const row = query.rows[0];
  if (!row) throw httpError('No está esa factura.', 404);
  const linesQuery = await target.query(
    `select id, document_id, row_number, order_number, product_name, seller_sku, falabella_sku,
            description, transaction_type, concept, net, igv, gross, statement_number,
            paid_reference, transacted_at
       from falabella_invoice_lines
      where document_id = $1
      order by transacted_at desc nulls last, row_number asc`,
    [documentId],
  );
  const lines = linesQuery.rows.map(mapLine);
  const statements = [...new Set(lines.map((line) => line.statementNumber).filter(Boolean))];
  const paymentRefs = [...new Set(lines.map((line) => line.paidReference).filter(Boolean))];
  return {
    ...mapDocument({ ...row, seller_id: row.seller_id || row.import_seller_id }),
    statements,
    paymentRefs,
    concepts: summarizeInvoiceConcepts(lines),
    lines,
  };
}

export async function loadInvoiceRefsForOrders(orderIds, db) {
  const refs = [...new Set((orderIds || []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (!refs.length) return [];
  const target = await resolvePool(db);
  const query = await target.query(
    `select distinct on (l.order_number, d.document_kind)
            l.order_number, d.id, d.document_number, d.document_kind
       from falabella_invoice_lines l
       join falabella_invoice_documents d on d.id = l.document_id
      where l.order_number = any($1::text[])
      order by l.order_number, d.document_kind, d.id desc`,
    [refs],
  );
  return query.rows.map((row) => ({
    orderNumber: row.order_number,
    id: Number(row.id),
    number: row.document_number,
    kind: row.document_kind,
  }));
}

export async function loadInvoiceChargesForOrders(orderIds, db) {
  const refs = [...new Set((orderIds || []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (!refs.length) return [];
  const target = await resolvePool(db);
  const query = await target.query(
    `select l.order_number, l.concept,
            sum(l.net) as net, sum(l.igv) as igv, sum(l.gross) as gross
       from falabella_invoice_lines l
      where l.order_number = any($1::text[])
      group by l.order_number, l.concept`,
    [refs],
  );
  return query.rows.map((row) => ({
    orderNumber: row.order_number,
    concept: row.concept,
    net: Number(row.net || 0),
    igv: Number(row.igv || 0),
    gross: Number(row.gross || 0),
  }));
}
