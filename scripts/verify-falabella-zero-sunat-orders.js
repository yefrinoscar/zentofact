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

async function fetchWantedForCompany(apiCompany, wanted, debug, allOrders) {
  const client = new FalabellaApiClient({
    userId: apiCompany.falabella_api_user_id,
    apiKey: apiCompany.falabella_api_key,
    version: apiCompany.__apiVersion,
    defaultFormat: 'JSON',
  });
  const ranges = [
    { label: 'created mayo-junio completo', filter: { createdAfter: '2026-05-01T00:00:00+00:00', createdBefore: '2026-06-30T23:59:59+00:00' } },
    { label: 'updated mayo-junio completo', filter: { updatedAfter: '2026-05-01T00:00:00+00:00', updatedBefore: '2026-06-30T23:59:59+00:00' } },
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
      if (found.size >= wanted.size) return found;
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
  if (!process.env.DATABASE_URL_POSTGRES) throw new Error('Missing DATABASE_URL_POSTGRES');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const pg = new Client({ connectionString: process.env.DATABASE_URL_POSTGRES });
  await pg.connect();
  try {
    const dbResult = await pg.query(
      `select c.id as company_id, c.nombre as company_name, c.seller_username,
              b.numero_completo, b.fecha_emision, b.estado_sunat, b.mto_imp_venta::numeric as total_db,
              b.order_number, ds.numero_completo as resumen, ds.fecha_resumen,
              cn.numero_completo as nota_credito, cn.fecha_emision as nota_fecha, cn.estado_sunat as nota_estado
       from boletas b
       join companies c on c.id = b.company_id
       left join daily_summaries ds on ds.id = b.daily_summary_id
       left join credit_notes cn on cn.affected_boleta_id = b.id
       where c.ruc = $1 and b.order_number = any($2)
       order by b.numero_completo`,
      [RUC, ORDER_NUMBERS],
    );
    const apiCompaniesResult = await pg.query(
      `select id, nombre, seller_username, falabella_api_user_id, falabella_api_key
       from companies
       where ruc = $1
         and falabella_api_user_id is not null
         and falabella_api_key is not null
       order by id`,
      [RUC],
    );
    if (!apiCompaniesResult.rows.length) throw new Error('No hay credenciales Falabella API para este RUC.');

    const wanted = new Set(ORDER_NUMBERS);
    const debug = [];
    const allOrders = [];
    const apiFound = new Map();
    for (const apiCompany of apiCompaniesResult.rows) {
      for (const version of ['2.0', '1.0']) {
        const found = await fetchWantedForCompany({ ...apiCompany, __apiVersion: version }, wanted, debug, allOrders);
      for (const [orderNumber, payload] of found) {
        if (!apiFound.has(orderNumber)) apiFound.set(orderNumber, payload);
      }
      }
    }

    const rows = dbResult.rows.map((dbRow) => {
      const api = apiFound.get(String(dbRow.order_number || '').trim());
      const order = api?.order || null;
      const falabellaPrice = priceOf(order);
      return {
        boleta: dbRow.numero_completo,
        orderNumber: dbRow.order_number,
        sistemaTotal: round2(dbRow.total_db),
        sunatCsvTotal: 0,
        falabellaEncontrada: order ? 'SI' : 'NO',
        falabellaSeller: api?.apiCompany?.seller_username || '',
        falabellaFoundIn: api?.foundIn || '',
        falabellaOrderId: order?.OrderId || '',
        falabellaCreatedAt: order?.CreatedAt || '',
        falabellaUpdatedAt: order?.UpdatedAt || '',
        falabellaStatus: statusesOf(order),
        falabellaInvoiceType: invoiceType(order?.InvoiceRequired),
        falabellaPrice,
        coincideSistemaFalabella: order && falabellaPrice !== '' && round2(falabellaPrice) === round2(dbRow.total_db) ? 'SI' : 'NO',
        estadoDb: dbRow.estado_sunat,
        resumen: dbRow.resumen || '',
        fechaResumen: dbRow.fecha_resumen || '',
        notaCredito: dbRow.nota_credito || '',
        notaEstado: dbRow.nota_estado || '',
        notaFecha: dbRow.nota_fecha || '',
      };
    });

    writeCsv(path.join(OUT_DIR, 'falabella_ordenes_sunat_0.csv'), rows);
    writeCsv(path.join(OUT_DIR, 'falabella_mayo_junio_order_numbers_revisados.csv'), allOrders);
    fs.writeFileSync(path.join(OUT_DIR, 'falabella_ordenes_sunat_0_debug.log'), `${debug.join('\n')}\n`);

    const lines = [
      '# Verificacion Falabella - boletas con total 0 en SUNAT',
      '',
      `Generado: ${new Date().toISOString()}`,
      '',
      'Busqueda ejecutada: mayo y junio completos (`2026-05-01` a `2026-06-30`) por `created` y por `updated`, en API v1.0 y v2.0, para Limbo y Higher.',
      '',
      '| Boleta | Orden | Sistema | SUNAT CSV | Falabella | Tipo | Estado Falabella | Coincide | Nota credito |',
      '| --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |',
      ...rows.map((row) => `| ${row.boleta} | ${row.orderNumber} | S/ ${money(row.sistemaTotal)} | S/ 0.00 | ${row.falabellaEncontrada === 'SI' ? `S/ ${money(row.falabellaPrice)}` : 'NO'} | ${row.falabellaInvoiceType || '-'} | ${row.falabellaStatus || '-'} | ${row.coincideSistemaFalabella} | ${row.notaCredito || '-'} |`),
      '',
      `Total sistema: S/ ${money(rows.reduce((sum, row) => sum + Number(row.sistemaTotal || 0), 0))}`,
      `Total Falabella encontrado: S/ ${money(rows.reduce((sum, row) => sum + Number(row.falabellaPrice || 0), 0))}`,
      '',
      'Archivos:',
      '- `falabella_ordenes_sunat_0.csv`',
      '- `falabella_mayo_junio_order_numbers_revisados.csv`',
      '- `falabella_ordenes_sunat_0_debug.log`',
    ];
    fs.writeFileSync(path.join(OUT_DIR, 'falabella_ordenes_sunat_0.md'), `${lines.join('\n')}\n`);
    console.log(lines.join('\n'));
  } finally {
    await pg.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
