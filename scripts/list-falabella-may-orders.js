const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  FalabellaApiClient,
  getFalabellaError,
  normalizeGetOrdersResult,
} = require('../packages/falabella-api/dist');

const DB_PATH = process.env.BOLETAS_DB_PATH || path.join(
  process.env.HOME,
  'Library/Application Support/@zentofact/desktop/storage/boletas.db',
);
const PERIOD_LABEL = process.env.FALABELLA_PERIOD_LABEL || 'mayo-2026';
const FROM_DATE = process.env.FALABELLA_FROM || '2026-05-01';
const TO_DATE = process.env.FALABELLA_TO || '2026-06-01';
const OUT_DIR = process.argv[2] || path.join('scripts', 'output', `falabella-${PERIOD_LABEL}`);
const CREATED_AFTER = `${FROM_DATE}T00:00:00+00:00`;
const CREATED_BEFORE = `${TO_DATE}T00:00:00+00:00`;
const LIMIT = 100;

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const companies = queryCompanies(`
    select id, ruc, razon_social, nombre_comercial, seller_username,
           falabella_api_user_id, falabella_api_key
    from companies
    where activo = 1
    order by id
  `);

  const allRows = [];
  const summary = [];
  const skipped = [];

  return runSequential(companies, async (company) => {
    const hasCredentials = String(company.falabella_api_user_id || '').trim()
      && String(company.falabella_api_key || '').trim();
    if (!hasCredentials) {
      skipped.push({
        companyId: company.id,
        username: company.seller_username,
        razonSocial: company.razon_social,
        reason: 'Sin credenciales Falabella Seller API en la base.',
      });
      return;
    }

    process.stdout.write(`[${company.id}] ${company.seller_username}... `);
    const client = new FalabellaApiClient({
      userId: company.falabella_api_user_id,
      apiKey: company.falabella_api_key,
      version: process.env.FALABELLA_API_VERSION || '1.0',
      defaultFormat: 'JSON',
    });

    const orders = [];
    for (let offset = 0; offset < 100000; offset += LIMIT) {
      const response = await client.getOrdersV2({
        createdAfter: CREATED_AFTER,
        createdBefore: CREATED_BEFORE,
        limit: LIMIT,
        offset,
        sortDirection: 'ASC',
      });

      const error = getFalabellaError(response.data);
      if (error) {
        throw new Error(`[${company.seller_username}] ${error.Head?.ErrorMessage || error.Head?.ErrorCode || 'Error Falabella'}`);
      }

      const normalized = normalizeGetOrdersResult(response.data);
      orders.push(...normalized.orders);
      if (!normalized.orders.length || normalized.orders.length < LIMIT) break;
    }

    const unique = dedupeOrders(orders);
    for (const order of unique) {
      allRows.push(normalizeOrder(company, order));
    }

    summary.push({
      companyId: company.id,
      ruc: company.ruc,
      razonSocial: company.razon_social,
      username: company.seller_username,
      orders: unique.length,
      boletas: unique.filter((order) => invoiceType(order.InvoiceRequired) === 'BOLETA').length,
      facturas: unique.filter((order) => invoiceType(order.InvoiceRequired) === 'FACTURA').length,
      sinTipo: unique.filter((order) => invoiceType(order.InvoiceRequired) === '').length,
      total: round2(unique.reduce((sum, order) => sum + parseAmount(order.Price), 0)),
    });
    process.stdout.write(`${unique.length} ordenes\n`);
  }).then(() => {
    allRows.sort((a, b) => (
      String(a.companyId).localeCompare(String(b.companyId), undefined, { numeric: true })
      || String(a.createdAt).localeCompare(String(b.createdAt))
      || String(a.orderNumber).localeCompare(String(b.orderNumber))
    ));

    writeCsv(path.join(OUT_DIR, `falabella-ordenes-${PERIOD_LABEL}.csv`), allRows);
    writeCsv(path.join(OUT_DIR, 'resumen-por-cuenta.csv'), summary);
    writePerAccountFiles(allRows, path.join(OUT_DIR, 'por-cuenta'));
    fs.writeFileSync(path.join(OUT_DIR, `falabella-ordenes-${PERIOD_LABEL}.json`), JSON.stringify({
      generatedAt: new Date().toISOString(),
      period: { createdAfter: CREATED_AFTER, createdBefore: CREATED_BEFORE },
      totalOrders: allRows.length,
      summary,
      skipped,
      orders: allRows,
    }, null, 2));
    fs.writeFileSync(path.join(OUT_DIR, 'cuentas-sin-api.json'), JSON.stringify(skipped, null, 2));

    console.log(`TOTAL ${allRows.length} ordenes`);
    if (skipped.length) {
      console.log(`SIN API ${skipped.map((item) => item.username).join(', ')}`);
    }
    console.log(`OUT ${OUT_DIR}`);
  });
}

function queryCompanies(sql) {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    try {
      return db.prepare(sql).all();
    } finally {
      db.close();
    }
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') throw error;
    const output = execFileSync('sqlite3', ['-json', DB_PATH, sql], { encoding: 'utf8' });
    return JSON.parse(output || '[]');
  }
}

async function runSequential(items, worker) {
  for (const item of items) {
    await worker(item);
  }
}

function dedupeOrders(orders) {
  const byKey = new Map();
  for (const order of orders) {
    const key = String(order.OrderNumber || order.OrderId || JSON.stringify(order));
    byKey.set(key, order);
  }
  return [...byKey.values()];
}

function normalizeOrder(company, order) {
  return {
    companyId: company.id,
    ruc: company.ruc,
    razonSocial: company.razon_social,
    cuenta: company.seller_username,
    orderId: value(order.OrderId),
    orderNumber: value(order.OrderNumber),
    createdAt: value(order.CreatedAt),
    updatedAt: value(order.UpdatedAt),
    status: statusText(order.Statuses),
    invoiceRequired: value(order.InvoiceRequired),
    tipoComprobante: invoiceType(order.InvoiceRequired),
    price: round2(parseAmount(order.Price)),
    paymentMethod: value(order.PaymentMethod),
    customerFirstName: value(order.CustomerFirstName),
    customerLastName: value(order.CustomerLastName),
    documentNumber: value(order.NationalRegistrationNumber),
    itemsCount: value(order.ItemsCount),
    deliveryInfo: value(order.DeliveryInfo),
  };
}

function invoiceType(invoiceRequiredValue) {
  if (invoiceRequiredValue === true || invoiceRequiredValue === 1) return 'FACTURA';
  if (invoiceRequiredValue === false || invoiceRequiredValue === 0) return 'BOLETA';
  const text = String(invoiceRequiredValue ?? '').trim().toLowerCase();
  if (text === 'true' || text === '1') return 'FACTURA';
  if (text === 'false' || text === '0') return 'BOLETA';
  return '';
}

function writePerAccountFiles(rows, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const byAccount = new Map();
  for (const row of rows) {
    const key = `${row.companyId}-${slug(row.cuenta || row.razonSocial)}`;
    const accountRows = byAccount.get(key) || [];
    accountRows.push(row);
    byAccount.set(key, accountRows);
  }
  for (const [key, accountRows] of byAccount) {
    writeCsv(path.join(outDir, `${key}.csv`), accountRows);
  }
}

function slug(input) {
  return String(input || 'cuenta')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function statusText(statuses) {
  if (!statuses) return '';
  if (typeof statuses === 'string') return statuses;
  const status = statuses.Status || statuses.status || statuses;
  if (Array.isArray(status)) return status.map(statusText).filter(Boolean).join('|');
  if (typeof status === 'object') return value(status.Name || status.name || JSON.stringify(status));
  return value(status);
}

function value(input) {
  if (input === null || input === undefined) return '';
  return String(input);
}

function parseAmount(input) {
  const cleaned = String(input || '').replace(/[^0-9,.\-]/g, '').replace(/,/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(input) {
  return Math.round((Number(input) || 0) * 100) / 100;
}

function writeCsv(filePath, rows) {
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const body = [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ].join('\n');
  fs.writeFileSync(filePath, body + '\n');
}

function csvCell(input) {
  const text = value(input);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
