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
const CREATED_AFTER = '2026-05-01T00:00:00+00:00';
const CREATED_BEFORE = '2026-06-01T00:00:00+00:00';

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function money(value) {
  return round2(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseAmount(value) {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
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
    const parsed = parseAmount(order?.[key]);
    if (parsed) return round2(parsed);
  }
  return 0;
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

async function fetchCreatedMayOrders(company, debug) {
  const client = new FalabellaApiClient({
    userId: company.falabella_api_user_id,
    apiKey: company.falabella_api_key,
    version: '2.0',
    defaultFormat: 'JSON',
  });
  const orders = [];
  const limit = 100;
  for (let offset = 0; offset < 10000; offset += limit) {
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
    debug.push(`${company.id} ${company.nombre || ''} ${company.seller_username || ''}: offset ${offset}, ${normalized.orders.length} orden(es), totalCount=${normalized.totalCount ?? 'n/a'}`);
    orders.push(...normalized.orders);
    if (!normalized.orders.length || normalized.orders.length < limit) break;
  }
  const unique = new Map();
  for (const order of orders) {
    const orderNumber = String(order.OrderNumber || '').trim();
    if (!orderNumber) continue;
    if (!unique.has(orderNumber)) unique.set(orderNumber, order);
  }
  return Array.from(unique.values());
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
    if (!companiesResult.rows.length) throw new Error(`No hay credenciales Falabella para RUC ${RUC}`);

    const debug = [];
    const rows = [];
    const summary = [];
    for (const company of companiesResult.rows) {
      const orders = await fetchCreatedMayOrders(company, debug);
      const normalized = orders.map((order) => ({
        companyId: company.id,
        company: company.nombre || company.razon_social || '',
        seller: company.seller_username || '',
        orderNumber: String(order.OrderNumber || ''),
        orderId: order.OrderId || '',
        createdAt: order.CreatedAt || '',
        updatedAt: order.UpdatedAt || '',
        invoiceRequired: String(order.InvoiceRequired ?? ''),
        tipoComprobante: invoiceType(order.InvoiceRequired),
        price: orderPrice(order),
        status: statusesOf(order),
      }));
      rows.push(...normalized);
      const boletas = normalized.filter((row) => row.tipoComprobante === 'BOLETA');
      const facturas = normalized.filter((row) => row.tipoComprobante === 'FACTURA');
      const sinTipo = normalized.filter((row) => row.tipoComprobante !== 'BOLETA' && row.tipoComprobante !== 'FACTURA');
      summary.push({
        companyId: company.id,
        company: company.nombre || '',
        seller: company.seller_username || '',
        orders: normalized.length,
        boletas: boletas.length,
        boletaTotal: round2(boletas.reduce((sum, row) => sum + row.price, 0)),
        facturas: facturas.length,
        facturaTotal: round2(facturas.reduce((sum, row) => sum + row.price, 0)),
        sinTipo: sinTipo.length,
        sinTipoTotal: round2(sinTipo.reduce((sum, row) => sum + row.price, 0)),
        total: round2(normalized.reduce((sum, row) => sum + row.price, 0)),
      });
    }

    const boletaRows = rows.filter((row) => row.tipoComprobante === 'BOLETA');
    writeCsv(path.join(OUT_DIR, 'falabella_mayo_boletas_limbo_higher.csv'), boletaRows);
    writeCsv(path.join(OUT_DIR, 'falabella_mayo_todas_ordenes_limbo_higher.csv'), rows);
    writeCsv(path.join(OUT_DIR, 'falabella_mayo_resumen_limbo_higher.csv'), summary);
    fs.writeFileSync(path.join(OUT_DIR, 'falabella_mayo_boletas_debug.log'), `${debug.join('\n')}\n`);

    const totalBoletas = boletaRows.length;
    const totalBoletasAmount = round2(boletaRows.reduce((sum, row) => sum + row.price, 0));
    const lines = [
      '# Falabella mayo 2026 - ventas con boleta Limbo/Higher',
      '',
      `Generado: ${new Date().toISOString()}`,
      `RUC: ${RUC}`,
      '',
      'Criterio: ordenes creadas en mayo 2026 en Falabella API, `InvoiceRequired=false/0`, deduplicadas por seller + `OrderNumber`.',
      '',
      '| Empresa | Seller | Ordenes mayo | Boletas | Total boletas | Facturas | Total facturas | Sin tipo | Total general |',
      '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
      ...summary.map((row) => `| ${row.company} | ${row.seller} | ${row.orders} | ${row.boletas} | S/ ${money(row.boletaTotal)} | ${row.facturas} | S/ ${money(row.facturaTotal)} | ${row.sinTipo} | S/ ${money(row.total)} |`),
      `| **TOTAL** |  | ${summary.reduce((sum, row) => sum + row.orders, 0)} | **${totalBoletas}** | **S/ ${money(totalBoletasAmount)}** | ${summary.reduce((sum, row) => sum + row.facturas, 0)} | S/ ${money(summary.reduce((sum, row) => sum + row.facturaTotal, 0))} | ${summary.reduce((sum, row) => sum + row.sinTipo, 0)} | S/ ${money(summary.reduce((sum, row) => sum + row.total, 0))} |`,
      '',
      'Archivos:',
      '- `falabella_mayo_boletas_limbo_higher.csv`',
      '- `falabella_mayo_todas_ordenes_limbo_higher.csv`',
      '- `falabella_mayo_resumen_limbo_higher.csv`',
      '- `falabella_mayo_boletas_debug.log`',
    ];
    fs.writeFileSync(path.join(OUT_DIR, 'falabella_mayo_boletas_limbo_higher.md'), `${lines.join('\n')}\n`);
    console.log(lines.join('\n'));
  } finally {
    await pg.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
