require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const RUC = '20612784192';
const PERIOD = '202605';
const COMPANY_ID = 8;
const BRANCH_ID = 8;
const CSV_FILE = '/Users/ylaurach/Library/CloudStorage/OneDrive2-Personal/zentoo/SELLERS/BEAUTY HOME/MAYO/LE206127841922026060014040001EXP2.csv';
const OUT_DIR = path.resolve('reports/beauty-home-mayo-2026');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(field);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    if (row.some((value) => value !== '')) rows.push(row);
  }
  return rows;
}

function normalizeHeader(value) {
  return String(value || '').replace(/^\uFEFF/, '').trim();
}

function toIsoDate(value) {
  const match = String(value || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : String(value || '').trim();
}

function normalizeNumber(value) {
  return String(value || '').trim().replace(/\D/g, '').padStart(6, '0');
}

function num(value) {
  const parsed = Number(String(value || '0').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function absNum(value) {
  return Math.abs(num(value));
}

function money(value) {
  return Number(value || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(file, rows, columns) {
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((column) => csvEscape(row[column])).join(','));
  fs.writeFileSync(path.join(OUT_DIR, file), `${lines.join('\n')}\n`);
}

function parseRows() {
  const table = parseCsv(fs.readFileSync(CSV_FILE, 'utf8'));
  const headers = table[0].map(normalizeHeader);
  return table.slice(1)
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] || ''])))
    .filter((row) => String(row.Ruc).trim() === RUC && String(row.Periodo).trim() === PERIOD)
    .filter((row) => String(row['Tipo CP/Doc.'] || '').trim().padStart(2, '0') === '03')
    .filter((row) => String(row['Serie del CDP'] || '').trim() === 'EB01')
    .map((row) => {
      const serie = String(row['Serie del CDP'] || '').trim();
      const correlativo = normalizeNumber(row['Nro CP o Doc. Nro Inicial (Rango)']);
      const total = num(row['Total CP']);
      return {
        serie,
        correlativo,
        numeroCompleto: `${serie}-${correlativo}`,
        fechaEmision: toIsoDate(row['Fecha de emisión']),
        tipoDocumentoCliente: String(row['Tipo Doc Identidad'] || '').trim() || '0',
        numeroDocumentoCliente: String(row['Nro Doc Identidad'] || '').trim() || '-',
        cliente: String(row['Apellidos Nombres/ Razón Social'] || '').trim() || '-',
        valorVenta: absNum(row['BI Gravada']) + absNum(row['Mto Exonerado']) + absNum(row['Mto Inafecto']) + absNum(row['Valor Facturado Exportación']),
        mtoOperGravadas: absNum(row['BI Gravada']),
        mtoOperExoneradas: absNum(row['Mto Exonerado']),
        mtoOperInafectas: absNum(row['Mto Inafecto']),
        mtoIgv: absNum(row['IGV / IPM']),
        mtoIsc: absNum(row.ISC),
        mtoIcbper: absNum(row.ICBPER),
        totalImpuestos: absNum(row['IGV / IPM']) + absNum(row.ISC) + absNum(row.ICBPER),
        subTotal: absNum(row['BI Gravada']) + absNum(row['Mto Exonerado']) + absNum(row['Mto Inafecto']) + absNum(row['Valor Facturado Exportación']),
        mtoImpVenta: Math.abs(total),
        moneda: String(row.Moneda || 'PEN').trim() || 'PEN',
        estadoComp: String(row['Est. Comp'] || '').trim(),
      };
    });
}

function buildDetail(row) {
  const base = row.valorVenta || Math.max(0, row.mtoImpVenta - row.totalImpuestos);
  const porcentajeIgv = row.mtoIgv > 0 && row.mtoOperGravadas > 0
    ? Math.round((row.mtoIgv / row.mtoOperGravadas) * 10000) / 100
    : 0;
  return [{
    codigo: row.numeroCompleto,
    descripcion: 'Comprobante importado de SUNAT mayo 2026 Beauty Home',
    unidad: 'NIU',
    cantidad: 1,
    mto_valor_unitario: Math.round(base * 100) / 100,
    porcentaje_igv: porcentajeIgv,
    tip_afe_igv: row.mtoOperGravadas > 0 ? '10' : row.mtoOperExoneradas > 0 ? '20' : '30',
  }];
}

async function getOrCreateClient(client, row) {
  const existing = await client.query(
    `select id from clients where company_id=$1 and tipo_documento=$2 and numero_documento=$3 limit 1`,
    [COMPANY_ID, row.tipoDocumentoCliente, row.numeroDocumentoCliente],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const now = Math.floor(Date.now() / 1000);
  const inserted = await client.query(
    `insert into clients (
      company_id, tipo_documento, numero_documento, razon_social, activo, created_at, updated_at
    ) values ($1,$2,$3,$4,true,$5,$5) returning id`,
    [COMPANY_ID, row.tipoDocumentoCliente, row.numeroDocumentoCliente, row.cliente, now],
  );
  return inserted.rows[0].id;
}

async function findExisting(client, numeroCompleto) {
  const result = await client.query(
    `select b.id, b.company_id from boletas b join companies c on c.id=b.company_id where c.ruc=$1 and b.tipo_documento='03' and b.numero_completo=$2 limit 1`,
    [RUC, numeroCompleto],
  );
  return result.rows[0] || null;
}

async function insertBoleta(client, row) {
  const existing = await findExisting(client, row.numeroCompleto);
  if (existing) return { action: 'skip_existing', id: existing.id, ...row };

  const clientId = await getOrCreateClient(client, row);
  const now = Math.floor(Date.now() / 1000);
  const estadoSunat = row.estadoComp === '2' ? 'ANULADO' : 'ACEPTADO';
  const result = await client.query(
    `insert into boletas (
      company_id, branch_id, client_id, tipo_documento, serie, correlativo, numero_completo,
      order_number, fecha_emision, ubl_version, tipo_operacion, moneda, metodo_envio,
      valor_venta, mto_oper_gravadas, mto_oper_exoneradas, mto_oper_inafectas,
      mto_oper_gratuitas, mto_igv_gratuitas, mto_igv, mto_base_ivap, mto_ivap,
      mto_isc, mto_icbper, total_impuestos, sub_total, mto_imp_venta,
      detalles, datos_adicionales, estado_sunat, respuesta_sunat, usuario_creacion,
      created_at, updated_at
    ) values (
      $1,$2,$3,'03',$4,$5,$6,
      null,$7,'2.1','0101',$8,'sunat_import',
      $9,$10,$11,$12,
      '0','0',$13,'0','0',
      $14,$15,$16,$17,$18,
      $19::jsonb,$20::jsonb,$21,$22,'sistema:importacion-sunat-beauty-home-mayo-2026',
      $23,$23
    ) returning id`,
    [
      COMPANY_ID, BRANCH_ID, clientId, row.serie, row.correlativo, row.numeroCompleto,
      row.fechaEmision, row.moneda, row.valorVenta, row.mtoOperGravadas, row.mtoOperExoneradas,
      row.mtoOperInafectas, row.mtoIgv, row.mtoIsc, row.mtoIcbper, row.totalImpuestos,
      row.subTotal, row.mtoImpVenta, JSON.stringify(buildDetail(row)),
      JSON.stringify({ source: 'SUNAT CSV mayo 2026', ruc: RUC, periodo: PERIOD, csvFile: CSV_FILE, estadoComp: row.estadoComp }),
      estadoSunat, JSON.stringify({ source: 'SUNAT CSV', estadoComp: row.estadoComp }),
      now,
    ],
  );
  return { action: 'inserted', id: result.rows[0].id, ...row };
}

async function main() {
  if (!process.env.DATABASE_URL_POSTGRES) throw new Error('Missing DATABASE_URL_POSTGRES');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const rows = parseRows();

  const pool = new Pool({ connectionString: process.env.DATABASE_URL_POSTGRES });
  const client = await pool.connect();
  const results = [];
  try {
    await client.query('begin');
    for (const row of rows) {
      results.push(await insertBoleta(client, row));
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  const columns = [
    'action', 'id', 'numeroCompleto', 'fechaEmision', 'mtoImpVenta',
    'cliente', 'tipoDocumentoCliente', 'numeroDocumentoCliente', 'estadoComp',
  ];
  writeCsv('registro_eb01_beauty_home_mayo.csv', results, columns);

  const inserted = results.filter((row) => row.action === 'inserted');
  const skipped = results.filter((row) => row.action === 'skip_existing');
  const totalInserted = inserted.reduce((sum, row) => sum + Number(row.mtoImpVenta || 0), 0);
  const totalAll = results.reduce((sum, row) => sum + Number(row.mtoImpVenta || 0), 0);

  const lines = [
    '# Registro EB01 Beauty Home mayo 2026',
    '',
    `Generado: ${new Date().toISOString()}`,
    `RUC: ${RUC}`,
    `Company/branch: ${COMPANY_ID}/${BRANCH_ID}`,
    `CSV: \`${CSV_FILE}\``,
    '',
    '| Resultado | Cantidad | Total |',
    '| --- | ---: | ---: |',
    `| EB01 en CSV | ${rows.length} | S/ ${money(totalAll)} |`,
    `| Insertadas | ${inserted.length} | S/ ${money(totalInserted)} |`,
    `| Ya existian | ${skipped.length} | S/ ${money(skipped.reduce((sum, row) => sum + Number(row.mtoImpVenta || 0), 0))} |`,
    '',
    'Detalle: `registro_eb01_beauty_home_mayo.csv`',
  ];
  fs.writeFileSync(path.join(OUT_DIR, 'registro_eb01_beauty_home_mayo.md'), `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
