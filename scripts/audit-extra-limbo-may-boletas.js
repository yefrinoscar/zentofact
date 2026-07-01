require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { FalabellaApiClient, getFalabellaError, normalizeGetOrdersResult } = require('../packages/falabella-api/dist');

const INPUT = process.argv[2] || '/Users/ylaurach/Downloads/LE206078091362026060014040001EXP2.csv';
const OUT_DIR = path.resolve(process.cwd(), 'reports', 'sunat-mayo-2026-limbo-higher');
const RUC = '20607809136';
const COMPANY_ID = 1;
const MAY_START = '2026-05-01';
const MAY_END = '2026-05-31';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++;
      row.push(field);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += ch;
  }
  if (field || row.length) {
    row.push(field);
    if (row.some((value) => value !== '')) rows.push(row);
  }
  return rows;
}

function header(value) {
  return String(value || '').replace(/^\uFEFF/, '').trim();
}

function normalNumber(value) {
  return String(value || '').replace(/\D/g, '').padStart(6, '0');
}

function readSunatBoletaSet() {
  const table = parseCsv(fs.readFileSync(INPUT, 'utf8'));
  const headers = table[0].map(header);
  const rows = table.slice(1).map((cells) => Object.fromEntries(headers.map((h, i) => [h, cells[i] || ''])));
  return new Set(rows
    .filter((row) => row.Ruc === RUC && row.Periodo === '202605' && String(row['Tipo CP/Doc.']).padStart(2, '0') === '03')
    .map((row) => `${String(row['Serie del CDP']).trim()}-${normalNumber(row['Nro CP o Doc. Nro Inicial (Rango)'])}`));
}

function money(value) {
  return Number(value || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(file, rows, columns) {
  const lines = [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(',')),
  ];
  fs.writeFileSync(path.join(OUT_DIR, file), `${lines.join('\n')}\n`);
}

function dateOnly(value) {
  return String(value || '').slice(0, 10);
}

function invoiceRequired(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') return value.toLowerCase() === 'true' || value === '1';
  return false;
}

function grossPrice(order) {
  const keys = ['Price', 'GrandTotal', 'TotalPrice', 'TotalAmount'];
  for (const key of keys) {
    const value = Number(order?.[key]);
    if (Number.isFinite(value) && value !== 0) return value;
  }
  return '';
}

async function fetchOrdersForRange(client, filter, wantedNumbers, label, debug) {
  const found = new Map();
  const limit = 100;
  for (let offset = 0; offset < 10000; offset += limit) {
    const response = await client.getOrdersV2({ ...filter, limit, offset });
    const error = getFalabellaError(response.data);
    if (error) {
      debug.push(`${label} offset ${offset}: ERROR ${error.Head?.ErrorMessage || error.Head?.ErrorCode || 'sin detalle'}`);
      break;
    }
    const normalized = normalizeGetOrdersResult(response.data);
    debug.push(`${label} offset ${offset}: ${normalized.orders.length} orden(es), totalCount=${normalized.totalCount ?? 'n/a'}`);
    for (const order of normalized.orders) {
      const orderNumber = String(order.OrderNumber || '').trim();
      if (wantedNumbers.has(orderNumber) && !found.has(orderNumber)) found.set(orderNumber, order);
    }
    if (!normalized.orders.length || normalized.orders.length < limit) break;
    if (found.size >= wantedNumbers.size) break;
  }
  return found;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sunatBoletas = readSunatBoletaSet();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_POSTGRES });

  const extraQuery = await pool.query(`
    select
      c.id as company_id,
      c.nombre as company_nombre,
      c.seller_username,
      c.falabella_api_user_id,
      c.falabella_api_key,
      b.id as boleta_id,
      b.numero_completo,
      b.serie,
      b.correlativo,
      b.fecha_emision,
      b.estado_sunat,
      b.mto_imp_venta::numeric as total,
      b.order_number,
      b.usuario_creacion,
      b.created_at,
      b.updated_at,
      b.daily_summary_id,
      ds.numero_completo as resumen,
      ds.fecha_resumen,
      ds.estado as resumen_estado,
      cn.numero_completo as nota_credito,
      cn.fecha_emision as nota_fecha
    from boletas b
    join companies c on c.id = b.company_id
    left join daily_summaries ds on ds.id = b.daily_summary_id
    left join credit_notes cn on cn.affected_boleta_id = b.id
    where c.ruc = $1
      and b.fecha_emision >= $2
      and b.fecha_emision <= $3
      and b.estado_sunat in ('ACEPTADO', 'ANULADO')
    order by b.numero_completo
  `, [RUC, MAY_START, MAY_END]);

  const extraRows = extraQuery.rows.filter((row) => !sunatBoletas.has(row.numero_completo));
  const companiesResult = await pool.query(`
    select id, nombre, seller_username, falabella_api_user_id, falabella_api_key
    from companies
    where ruc = $1 and falabella_api_user_id is not null and falabella_api_key is not null
    order by id
  `, [RUC]);
  const apiCompanies = companiesResult.rows;
  if (!apiCompanies.length) throw new Error('No hay empresas con credenciales Falabella API para auditar.');

  const wantedNumbers = new Set(extraRows.map((row) => String(row.order_number || '').trim()).filter(Boolean));
  const debug = [];
  const apiFound = new Map();
  const ranges = [
    {
      label: 'created mayo completo',
      filter: { createdAfter: '2026-05-01T00:00:00+00:00', createdBefore: '2026-05-31T23:59:59+00:00' },
    },
    {
      label: 'updated mayo completo',
      filter: { updatedAfter: '2026-05-01T00:00:00+00:00', updatedBefore: '2026-05-31T23:59:59+00:00' },
    },
    {
      label: 'created abril-mayo',
      filter: { createdAfter: '2026-04-01T00:00:00+00:00', createdBefore: '2026-05-31T23:59:59+00:00' },
    },
    {
      label: 'updated hasta junio 5',
      filter: { updatedAfter: '2026-05-25T00:00:00+00:00', updatedBefore: '2026-06-05T23:59:59+00:00' },
    },
  ];

  for (const apiCompany of apiCompanies) {
    const apiClient = new FalabellaApiClient({
      userId: apiCompany.falabella_api_user_id,
      apiKey: apiCompany.falabella_api_key,
      version: '2.0',
      defaultFormat: 'JSON',
    });
    const labelPrefix = `${apiCompany.id} ${apiCompany.nombre || ''} ${apiCompany.seller_username || ''}`.trim();
    for (const range of ranges) {
      const found = await fetchOrdersForRange(apiClient, range.filter, wantedNumbers, `${labelPrefix} / ${range.label}`, debug);
      for (const [orderNumber, order] of found) {
        if (!apiFound.has(orderNumber)) {
          apiFound.set(orderNumber, { order, foundIn: range.label, apiCompany });
        }
      }
    }
  }

  const reportRows = extraRows.map((row) => {
    const api = apiFound.get(String(row.order_number || '').trim());
    const order = api?.order || null;
    const createdAt = order?.CreatedAt || '';
    const updatedAt = order?.UpdatedAt || '';
    const createdMonth = dateOnly(createdAt).slice(0, 7);
    return {
      numeroCompleto: row.numero_completo,
      fechaEmisionDb: row.fecha_emision,
      totalDb: Number(row.total || 0),
      estadoDb: row.estado_sunat,
      orderNumber: row.order_number || '',
      company: row.company_nombre,
      summary: row.resumen || '',
      summaryDate: row.fecha_resumen || '',
      summaryState: row.resumen_estado || '',
      notaCredito: row.nota_credito || '',
      notaFecha: row.nota_fecha || '',
      dbCreatedAt: row.created_at ? new Date(Number(row.created_at) * 1000).toISOString() : '',
      falabellaFound: order ? 'SI' : 'NO',
      falabellaSeller: api?.apiCompany?.seller_username || '',
      falabellaSellerCompany: api?.apiCompany?.nombre || '',
      falabellaFoundIn: api?.foundIn || '',
      falabellaOrderId: order?.OrderId || '',
      falabellaCreatedAt: createdAt,
      falabellaUpdatedAt: updatedAt,
      falabellaStatus: Array.isArray(order?.Statuses?.Status)
        ? order.Statuses.Status.join('|')
        : typeof order?.Statuses === 'object'
          ? JSON.stringify(order.Statuses)
          : (order?.Statuses || ''),
      falabellaInvoiceRequired: order ? String(invoiceRequired(order.InvoiceRequired)) : '',
      falabellaPrice: grossPrice(order),
      originConclusion: !order
        ? 'No encontrada en Falabella API'
        : createdMonth === '2026-04'
          ? 'Orden creada en abril en Falabella'
          : createdMonth === '2026-05'
            ? 'Orden creada en mayo en Falabella'
            : `Orden creada en ${createdMonth || 'fecha desconocida'} en Falabella`,
    };
  });

  const columns = [
    'numeroCompleto', 'fechaEmisionDb', 'totalDb', 'estadoDb', 'orderNumber', 'company',
    'summary', 'summaryDate', 'summaryState', 'notaCredito', 'notaFecha', 'dbCreatedAt',
    'falabellaFound', 'falabellaSeller', 'falabellaSellerCompany', 'falabellaFoundIn', 'falabellaOrderId', 'falabellaCreatedAt',
    'falabellaUpdatedAt', 'falabellaStatus', 'falabellaInvoiceRequired', 'falabellaPrice',
    'originConclusion',
  ];
  writeCsv('auditoria_41_boletas_extra.csv', reportRows, columns);

  const byConclusion = new Map();
  for (const row of reportRows) {
    const current = byConclusion.get(row.originConclusion) || { count: 0, total: 0 };
    current.count += 1;
    current.total += row.totalDb;
    byConclusion.set(row.originConclusion, current);
  }

  const lines = [];
  lines.push('# Auditoria de 41 boletas extra - Limbo mayo 2026');
  lines.push('');
  lines.push(`CSV SUNAT: \`${INPUT}\``);
  lines.push(`RUC: \`${RUC}\``);
  lines.push(`Generado: ${new Date().toLocaleString('sv-SE', { timeZone: 'America/Lima' })} America/Lima`);
  lines.push('');
  lines.push('## Resultado');
  lines.push('');
  lines.push(`Se encontraron ${reportRows.length} boletas en Postgres con fecha de emision mayo 2026 que no aparecen en el CSV SUNAT mayo.`);
  lines.push(`Monto total: S/ ${money(reportRows.reduce((sum, row) => sum + row.totalDb, 0))}.`);
  lines.push('');
  lines.push('| Conclusion | Cantidad | Total |');
  lines.push('|---|---:|---:|');
  for (const [conclusion, value] of byConclusion) {
    lines.push(`| ${conclusion} | ${value.count} | S/ ${money(value.total)} |`);
  }
  lines.push('');
  lines.push('## Detalle');
  lines.push('');
  lines.push('| Boleta | Fecha DB | Total DB | Orden | Resumen | NC | Falabella | Seller API | Creada Falabella | Conclusion |');
  lines.push('|---|---|---:|---|---|---|---|---|---|---|');
  for (const row of reportRows) {
    lines.push(`| ${row.numeroCompleto} | ${row.fechaEmisionDb} | S/ ${money(row.totalDb)} | ${row.orderNumber} | ${row.summary || '-'} | ${row.notaCredito || '-'} | ${row.falabellaFound} | ${row.falabellaSeller || '-'} | ${dateOnly(row.falabellaCreatedAt) || '-'} | ${row.originConclusion} |`);
  }
  lines.push('');
  lines.push('## Falabella API Debug');
  lines.push('');
  for (const line of debug) lines.push(`- ${line}`);
  lines.push('');
  lines.push('## Archivos');
  lines.push('');
  lines.push('- `auditoria_41_boletas_extra.csv`');
  lines.push('');

  fs.writeFileSync(path.join(OUT_DIR, 'auditoria_41_boletas_extra.md'), `${lines.join('\n')}\n`);

  console.log(JSON.stringify({
    outDir: OUT_DIR,
    count: reportRows.length,
    total: Number(reportRows.reduce((sum, row) => sum + row.totalDb, 0).toFixed(2)),
    falabellaFound: reportRows.filter((row) => row.falabellaFound === 'SI').length,
    byConclusion: Object.fromEntries(byConclusion),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
