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
const ORDER_NUMBERS = ['3235484412', '3235414296', '3235394863', '3235386304'];
const APRIL_CSV = '/Users/ylaurach/Library/CloudStorage/OneDrive2-Personal/zentoo/SELLERS/LIMBO/ABRIL/LE206078091362026060014040001EXP2.csv';

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
  const lines = text.split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, i) => [header, values[i] || '']));
  });
}

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function money(value) {
  return round2(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function valueOf(order, keys) {
  for (const key of keys) {
    const value = order?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function priceOf(order) {
  const value = valueOf(order, ['Price', 'GrandTotal', 'TotalPrice', 'TotalAmount']);
  return value === '' ? '' : round2(value);
}

function invoiceType(value) {
  if (typeof value === 'boolean') return value ? 'FACTURA' : 'BOLETA';
  if (typeof value === 'number') return value === 1 ? 'FACTURA' : 'BOLETA';
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'true' || text === '1') return 'FACTURA';
  if (text === 'false' || text === '0') return 'BOLETA';
  return text ? String(value) : '';
}

function statusesOf(order) {
  const raw = order?.Statuses?.Status || order?.Status || order?.Statuses;
  if (Array.isArray(raw)) return raw.map((item) => typeof item === 'string' ? item : item?.Status || item?.Name || JSON.stringify(item)).join('; ');
  if (raw && typeof raw === 'object') return raw.Status || raw.Name || JSON.stringify(raw);
  return String(raw || '');
}

async function fetchApril(apiCompany, wanted, debug, allOrders) {
  const client = new FalabellaApiClient({
    userId: apiCompany.falabella_api_user_id,
    apiKey: apiCompany.falabella_api_key,
    version: apiCompany.__apiVersion,
    defaultFormat: 'JSON',
  });
  const ranges = [
    { label: 'created abril completo', filter: { createdAfter: '2026-04-01T00:00:00+00:00', createdBefore: '2026-04-30T23:59:59+00:00' } },
    { label: 'updated abril completo', filter: { updatedAfter: '2026-04-01T00:00:00+00:00', updatedBefore: '2026-04-30T23:59:59+00:00' } },
  ];

  const found = new Map();
  for (const range of ranges) {
    const limit = 100;
    for (let offset = 0; offset < 10000; offset += limit) {
      const response = await client.getOrdersV2({ ...range.filter, limit, offset });
      const error = getFalabellaError(response.data);
      const label = `${apiCompany.id} ${apiCompany.nombre || ''} ${apiCompany.seller_username || ''} v${apiCompany.__apiVersion} / ${range.label} offset ${offset}`;
      if (error) {
        debug.push(`${label}: ERROR ${error.Head?.ErrorMessage || error.Head?.ErrorCode || 'sin detalle'}`);
        break;
      }
      const normalized = normalizeGetOrdersResult(response.data);
      debug.push(`${label}: ${normalized.orders.length} orden(es), totalCount=${normalized.totalCount ?? 'n/a'}`);
      for (const order of normalized.orders) {
        const orderNumber = String(order.OrderNumber || '').trim();
        if (orderNumber) {
          allOrders.push({
            apiVersion: apiCompany.__apiVersion,
            seller: apiCompany.seller_username || '',
            range: range.label,
            orderNumber,
            orderId: order.OrderId || '',
            createdAt: order.CreatedAt || '',
            updatedAt: order.UpdatedAt || '',
            status: statusesOf(order),
            invoiceType: invoiceType(order.InvoiceRequired),
            price: priceOf(order),
          });
        }
        if (wanted.has(orderNumber) && !found.has(orderNumber)) {
          found.set(orderNumber, { order, apiCompany, foundIn: range.label });
        }
      }
      if (!normalized.orders.length || normalized.orders.length < limit) break;
    }
  }
  return found;
}

function writeCsv(file, rows) {
  const columns = rows[0] ? Object.keys(rows[0]) : ['empty'];
  const escape = (value) => {
    const str = String(value ?? '');
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((column) => escape(row[column])).join(','));
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const aprilCsvText = fs.existsSync(APRIL_CSV) ? fs.readFileSync(APRIL_CSV, 'utf8') : '';
  const aprilCsvMatches = ORDER_NUMBERS.map((orderNumber) => ({
    orderNumber,
    foundInAprilCsvText: aprilCsvText.includes(orderNumber) ? 'SI' : 'NO',
  }));

  const pg = new Client({ connectionString: process.env.DATABASE_URL_POSTGRES });
  await pg.connect();
  try {
    const companies = await pg.query(
      `select id, nombre, seller_username, falabella_api_user_id, falabella_api_key
       from companies
       where ruc = $1
         and falabella_api_user_id is not null
         and falabella_api_key is not null
       order by id`,
      [RUC],
    );
    const wanted = new Set(ORDER_NUMBERS);
    const debug = [];
    const allOrders = [];
    const apiFound = new Map();
    for (const company of companies.rows) {
      for (const version of ['2.0', '1.0']) {
        const found = await fetchApril({ ...company, __apiVersion: version }, wanted, debug, allOrders);
        for (const [orderNumber, payload] of found) {
          if (!apiFound.has(orderNumber)) apiFound.set(orderNumber, payload);
        }
      }
    }

    const rows = ORDER_NUMBERS.map((orderNumber) => {
      const api = apiFound.get(orderNumber);
      const order = api?.order || null;
      return {
        orderNumber,
        falabellaEncontradaAbril: order ? 'SI' : 'NO',
        falabellaSeller: api?.apiCompany?.seller_username || '',
        falabellaFoundIn: api?.foundIn || '',
        falabellaOrderId: order?.OrderId || '',
        falabellaCreatedAt: order?.CreatedAt || '',
        falabellaUpdatedAt: order?.UpdatedAt || '',
        falabellaStatus: statusesOf(order),
        falabellaInvoiceType: invoiceType(order?.InvoiceRequired),
        falabellaPrice: priceOf(order),
        foundInAprilCsvText: aprilCsvMatches.find((row) => row.orderNumber === orderNumber)?.foundInAprilCsvText || 'NO',
      };
    });

    writeCsv(path.join(OUT_DIR, 'falabella_abril_order_numbers_revisados.csv'), allOrders);
    writeCsv(path.join(OUT_DIR, 'falabella_ordenes_sunat_0_abril.csv'), rows);
    fs.writeFileSync(path.join(OUT_DIR, 'falabella_ordenes_sunat_0_abril_debug.log'), `${debug.join('\n')}\n`);

    const lines = [
      '# Verificacion abril - ordenes con total 0 en SUNAT mayo',
      '',
      `Generado: ${new Date().toISOString()}`,
      '',
      '| Orden | Falabella abril | Seller | Creada | Actualizada | Estado | Tipo | Precio | CSV SUNAT abril texto |',
      '| --- | --- | --- | --- | --- | --- | --- | ---: | --- |',
      ...rows.map((row) => `| ${row.orderNumber} | ${row.falabellaEncontradaAbril} | ${row.falabellaSeller || '-'} | ${row.falabellaCreatedAt || '-'} | ${row.falabellaUpdatedAt || '-'} | ${row.falabellaStatus || '-'} | ${row.falabellaInvoiceType || '-'} | ${row.falabellaPrice === '' ? '-' : `S/ ${money(row.falabellaPrice)}`} | ${row.foundInAprilCsvText} |`),
      '',
      'Archivos:',
      '- `falabella_ordenes_sunat_0_abril.csv`',
      '- `falabella_abril_order_numbers_revisados.csv`',
      '- `falabella_ordenes_sunat_0_abril_debug.log`',
    ];
    fs.writeFileSync(path.join(OUT_DIR, 'falabella_ordenes_sunat_0_abril.md'), `${lines.join('\n')}\n`);
    console.log(lines.join('\n'));
  } finally {
    await pg.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
