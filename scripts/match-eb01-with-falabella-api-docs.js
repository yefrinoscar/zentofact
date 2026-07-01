const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Client } = require('pg');
const {
  FalabellaApiClient,
  getFalabellaError,
  normalizeGetOrdersResult,
} = require('../packages/falabella-api/dist');

const RUC = '20607809136';
const OUT_DIR = path.resolve('reports/mayo-2026-boletas-claro');
const SUNAT_MAY = '/Users/ylaurach/Library/CloudStorage/OneDrive2-Personal/zentoo/SELLERS/LIMBO/MAYO/LE206078091362026060014040001EXP2.csv';
const CREATED_AFTER = '2026-04-01T00:00:00+00:00';
const CREATED_BEFORE = '2026-07-01T00:00:00+00:00';

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function readCsv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, i) => [header, values[i] || '']));
  });
}

function amount(value) {
  const parsed = Number(String(value ?? '').replace(/[^0-9,.\-]/g, '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) / 100 : 0;
}

function money(value) {
  return amount(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function normDoc(value) {
  return String(value || '').replace(/\D/g, '').replace(/^0+/, '') || String(value || '').replace(/\D/g, '');
}

function normName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSunatDate(value) {
  const [dd, mm, yyyy] = String(value || '').split('/');
  if (!yyyy) return '';
  return `${yyyy}-${mm}-${dd}`;
}

function dateOnly(value) {
  return String(value || '').slice(0, 10);
}

function dayDistance(a, b) {
  if (!a || !b) return 9999;
  const da = new Date(`${a}T00:00:00Z`);
  const db = new Date(`${b}T00:00:00Z`);
  return Math.abs(Math.round((da - db) / 86400000));
}

function invoiceType(value) {
  if (typeof value === 'boolean') return value ? 'FACTURA' : 'BOLETA';
  if (typeof value === 'number') return value === 1 ? 'FACTURA' : 'BOLETA';
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'true' || text === '1') return 'FACTURA';
  if (text === 'false' || text === '0') return 'BOLETA';
  return text ? String(value) : 'SIN_TIPO';
}

function statusesOf(order) {
  const raw = order?.Statuses?.Status || order?.Status || order?.Statuses;
  if (Array.isArray(raw)) return raw.map((item) => typeof item === 'string' ? item : item?.Status || item?.Name || JSON.stringify(item)).join('; ');
  if (raw && typeof raw === 'object') return raw.Status || raw.Name || JSON.stringify(raw);
  return String(raw || '');
}

function orderPrice(order) {
  for (const key of ['Price', 'GrandTotal', 'TotalPrice', 'TotalAmount']) {
    const parsed = amount(order?.[key]);
    if (parsed) return parsed;
  }
  return 0;
}

function clientName(order) {
  return [order.CustomerFirstName, order.CustomerLastName].filter(Boolean).join(' ').trim();
}

function csvEscape(value) {
  const str = String(value ?? '');
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function writeCsv(file, rows) {
  const columns = rows[0] ? Object.keys(rows[0]) : ['empty'];
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((column) => csvEscape(row[column])).join(','));
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

function sunatEb01Rows() {
  return readCsv(SUNAT_MAY)
    .filter((row) => String(row['Tipo CP/Doc.']).padStart(2, '0') === '03')
    .filter((row) => String(row['Serie del CDP']).trim() === 'EB01')
    .map((row) => ({
      boletaSunat: `EB01-${String(row['Nro CP o Doc. Nro Inicial (Rango)']).padStart(6, '0')}`,
      sunatFecha: row['Fecha de emisión'],
      sunatIsoDate: parseSunatDate(row['Fecha de emisión']),
      sunatTotal: amount(row['Total CP']),
      sunatDocType: row['Tipo Doc Identidad'],
      sunatDoc: row['Nro Doc Identidad'],
      sunatDocNorm: normDoc(row['Nro Doc Identidad']),
      sunatName: row['Apellidos Nombres/ Razón Social'],
      sunatNameNorm: normName(row['Apellidos Nombres/ Razón Social']),
    }));
}

async function fetchOrders(company) {
  const client = new FalabellaApiClient({
    userId: company.falabella_api_user_id,
    apiKey: company.falabella_api_key,
    version: '2.0',
    defaultFormat: 'JSON',
  });
  const orders = [];
  const limit = 100;
  for (let offset = 0; offset < 20000; offset += limit) {
    const response = await client.getOrdersV2({
      createdAfter: CREATED_AFTER,
      createdBefore: CREATED_BEFORE,
      limit,
      offset,
      sortDirection: 'ASC',
    });
    const error = getFalabellaError(response.data);
    if (error) {
      throw new Error(`[${company.seller_username}] ${error.Head?.ErrorMessage || error.Head?.ErrorCode || 'Error Falabella'}`);
    }
    const normalized = normalizeGetOrdersResult(response.data);
    orders.push(...normalized.orders);
    if (!normalized.orders.length || normalized.orders.length < limit) break;
  }
  const unique = new Map();
  for (const order of orders) {
    const orderNumber = String(order.OrderNumber || '').trim();
    if (!orderNumber) continue;
    unique.set(orderNumber, order);
  }
  return Array.from(unique.values()).map((order) => ({
    companyId: company.id,
    company: company.nombre || company.razon_social || '',
    seller: company.seller_username || '',
    orderNumber: String(order.OrderNumber || ''),
    orderId: order.OrderId || '',
    createdAt: order.CreatedAt || '',
    updatedAt: order.UpdatedAt || '',
    tipoComprobante: invoiceType(order.InvoiceRequired),
    price: orderPrice(order),
    status: statusesOf(order),
    documentNumber: order.NationalRegistrationNumber || '',
    documentNorm: normDoc(order.NationalRegistrationNumber),
    customerName: clientName(order),
    customerNameNorm: normName(clientName(order)),
  }));
}

function scoreCandidate(sunat, order) {
  const amountDiff = Math.abs(amount(sunat.sunatTotal - order.price));
  const dateDistance = dayDistance(sunat.sunatIsoDate, dateOnly(order.createdAt));
  const docMatch = sunat.sunatDocNorm && order.documentNorm && sunat.sunatDocNorm === order.documentNorm;
  const nameMatch = sunat.sunatNameNorm && order.customerNameNorm && sunat.sunatNameNorm === order.customerNameNorm;
  const amountExact = amountDiff <= 0.05;
  if (!amountExact) return null;
  if (docMatch) return { confidence: 'alta', matchType: 'documento_monto', rank: 1, dateDistance, amountDiff };
  if (nameMatch) return { confidence: 'media_alta', matchType: 'nombre_monto', rank: 2, dateDistance, amountDiff };
  if (dateDistance <= 3) return { confidence: 'media', matchType: 'monto_fecha_cercana', rank: 3, dateDistance, amountDiff };
  if (dateDistance <= 31) return { confidence: 'baja', matchType: 'monto_fecha_lejana', rank: 4, dateDistance, amountDiff };
  return null;
}

async function main() {
  if (!process.env.DATABASE_URL_POSTGRES) throw new Error('Missing DATABASE_URL_POSTGRES');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const pg = new Client({ connectionString: process.env.DATABASE_URL_POSTGRES });
  await pg.connect();
  try {
    const companiesResult = await pg.query(
      `select id, nombre, razon_social, seller_username, falabella_api_user_id, falabella_api_key
       from companies
       where ruc = $1
         and falabella_api_user_id is not null
         and falabella_api_key is not null
       order by id`,
      [RUC],
    );
    const orders = [];
    for (const company of companiesResult.rows) {
      orders.push(...await fetchOrders(company));
    }
    const boletaOrders = orders.filter((order) => order.tipoComprobante === 'BOLETA');
    writeCsv(path.join(OUT_DIR, 'falabella_abr_jun_boletas_con_cliente.csv'), boletaOrders);

    const sunatRows = sunatEb01Rows();
    const candidates = [];
    for (const sunat of sunatRows) {
      for (const order of boletaOrders) {
        const score = scoreCandidate(sunat, order);
        if (!score) continue;
        candidates.push({ sunat, order, ...score });
      }
    }
    candidates.sort((a, b) => (
      a.rank - b.rank
      || a.dateDistance - b.dateDistance
      || String(a.sunat.boletaSunat).localeCompare(String(b.sunat.boletaSunat))
    ));

    const usedSunat = new Set();
    const usedOrders = new Set();
    const matches = [];
    for (const candidate of candidates) {
      if (usedSunat.has(candidate.sunat.boletaSunat) || usedOrders.has(candidate.order.orderNumber)) continue;
      usedSunat.add(candidate.sunat.boletaSunat);
      usedOrders.add(candidate.order.orderNumber);
      matches.push({
        confidence: candidate.confidence,
        matchType: candidate.matchType,
        boletaSunat: candidate.sunat.boletaSunat,
        sunatFecha: candidate.sunat.sunatFecha,
        sunatTotal: candidate.sunat.sunatTotal,
        sunatDoc: candidate.sunat.sunatDoc,
        sunatName: candidate.sunat.sunatName,
        orderNumber: candidate.order.orderNumber,
        orderId: candidate.order.orderId,
        seller: candidate.order.seller,
        falabellaCreatedAt: candidate.order.createdAt,
        falabellaUpdatedAt: candidate.order.updatedAt,
        falabellaTotal: candidate.order.price,
        falabellaDoc: candidate.order.documentNumber,
        falabellaName: candidate.order.customerName,
        status: candidate.order.status,
        dayDistance: candidate.dateDistance,
        amountDiff: candidate.amountDiff,
      });
    }

    const unmatchedSunat = sunatRows
      .filter((row) => !usedSunat.has(row.boletaSunat))
      .map((row) => ({
        boletaSunat: row.boletaSunat,
        sunatFecha: row.sunatFecha,
        sunatTotal: row.sunatTotal,
        sunatDoc: row.sunatDoc,
        sunatName: row.sunatName,
      }));
    const unmatchedOrders = boletaOrders
      .filter((row) => !usedOrders.has(row.orderNumber))
      .map((row) => ({
        orderNumber: row.orderNumber,
        orderId: row.orderId,
        seller: row.seller,
        falabellaCreatedAt: row.createdAt,
        falabellaTotal: row.price,
        falabellaDoc: row.documentNumber,
        falabellaName: row.customerName,
        status: row.status,
      }));

    writeCsv(path.join(OUT_DIR, 'eb01_falabella_api_matches.csv'), matches);
    writeCsv(path.join(OUT_DIR, 'eb01_falabella_api_sunat_no_match.csv'), unmatchedSunat);
    writeCsv(path.join(OUT_DIR, 'eb01_falabella_api_orders_no_match.csv'), unmatchedOrders);

    const byConfidence = new Map();
    for (const row of matches) {
      const current = byConfidence.get(row.confidence) || { confidence: row.confidence, count: 0, total: 0 };
      current.count += 1;
      current.total = amount(current.total + amount(row.sunatTotal));
      byConfidence.set(row.confidence, current);
    }
    const summary = [
      { metric: 'EB01 SUNAT mayo', count: sunatRows.length, total: amount(sunatRows.reduce((sum, row) => sum + row.sunatTotal, 0)) },
      { metric: 'Falabella boletas abril-junio API', count: boletaOrders.length, total: amount(boletaOrders.reduce((sum, row) => sum + row.price, 0)) },
      { metric: 'EB01 emparejadas', count: matches.length, total: amount(matches.reduce((sum, row) => sum + amount(row.sunatTotal), 0)) },
      { metric: 'EB01 sin match', count: unmatchedSunat.length, total: amount(unmatchedSunat.reduce((sum, row) => sum + row.sunatTotal, 0)) },
    ];
    writeCsv(path.join(OUT_DIR, 'eb01_falabella_api_summary.csv'), [...summary, ...Array.from(byConfidence.values())]);

    const lines = [
      '# Match EB01 SUNAT mayo vs Falabella API abril-junio',
      '',
      `Generado: ${new Date().toISOString()}`,
      '',
      'Criterio: primero documento + monto exacto; luego nombre + monto exacto; luego monto exacto + cercania de fecha.',
      '',
      '| Resultado | Cantidad | Total |',
      '| --- | ---: | ---: |',
      ...summary.map((row) => `| ${row.metric} | ${row.count} | S/ ${money(row.total)} |`),
      '',
      '## Calidad de matches',
      '',
      '| Confianza | Cantidad | Total |',
      '| --- | ---: | ---: |',
      ...Array.from(byConfidence.values()).map((row) => `| ${row.confidence} | ${row.count} | S/ ${money(row.total)} |`),
      '',
      'Archivos:',
      '- `eb01_falabella_api_matches.csv`',
      '- `eb01_falabella_api_sunat_no_match.csv`',
      '- `eb01_falabella_api_orders_no_match.csv`',
      '- `falabella_abr_jun_boletas_con_cliente.csv`',
    ];
    fs.writeFileSync(path.join(OUT_DIR, 'eb01_falabella_api_matches.md'), `${lines.join('\n')}\n`);
    console.log(lines.join('\n'));
  } finally {
    await pg.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
