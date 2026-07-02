require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const RUC = '20612600563';
const PERIOD = '202605';
const COMPANY_ID = 2;
const BRANCH_ID = 2;
const CSV_FILE = process.env.DOLPHIN_CSV
  || '/private/tmp/claude-501/-Users-ylaurach-Documents-repos-p-zentofact/663d2872-311e-4885-a7f7-94aa1b9b17c7/scratchpad/dolphin/LE206126005632026060014040001EXP2.csv';
const OUT_DIR = path.resolve('reports/dolphin-mayo-2026');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"') {
      if (quoted && next === '"') { field += '"'; i += 1; } else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(field); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(field);
      if (row.some((value) => value !== '')) rows.push(row);
      row = []; field = '';
    } else field += char;
  }
  if (field || row.length) { row.push(field); if (row.some((value) => value !== '')) rows.push(row); }
  return rows;
}

const normalizeHeader = (value) => String(value || '').replace(/^﻿/, '').trim();
const toIsoDate = (value) => {
  const m = String(value || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(value || '').trim();
};
const normalizeNumber = (value) => String(value || '').trim().replace(/\D/g, '').padStart(6, '0');
const num = (value) => { const p = Number(String(value || '0').replace(/,/g, '')); return Number.isFinite(p) ? p : 0; };
const absNum = (value) => Math.abs(num(value));
const money = (value) => Number(value || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const csvEscape = (value) => { const t = String(value ?? ''); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

function writeCsv(file, rows, columns) {
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvEscape(row[c])).join(','));
  fs.writeFileSync(path.join(OUT_DIR, file), `${lines.join('\n')}\n`);
}

function parseRows() {
  const table = parseCsv(fs.readFileSync(CSV_FILE, 'utf8'));
  const headers = table[0].map(normalizeHeader);
  return table.slice(1)
    .map((cells) => Object.fromEntries(headers.map((h, i) => [h, cells[i] || ''])))
    .filter((r) => String(r.Ruc).trim() === RUC && String(r.Periodo).trim() === PERIOD)
    .filter((r) => String(r['Tipo CP/Doc.'] || '').trim().padStart(2, '0') === '03')
    .filter((r) => String(r['Serie del CDP'] || '').trim() === 'EB01')
    .map((r) => {
      const serie = String(r['Serie del CDP'] || '').trim();
      const correlativo = normalizeNumber(r['Nro CP o Doc. Nro Inicial (Rango)']);
      return {
        serie, correlativo,
        numeroCompleto: `${serie}-${correlativo}`,
        fechaEmision: toIsoDate(r['Fecha de emisión']),
        tipoDocumentoCliente: String(r['Tipo Doc Identidad'] || '').trim() || '0',
        numeroDocumentoCliente: String(r['Nro Doc Identidad'] || '').trim() || '-',
        cliente: String(r['Apellidos Nombres/ Razón Social'] || '').trim() || '-',
        valorVenta: absNum(r['BI Gravada']) + absNum(r['Mto Exonerado']) + absNum(r['Mto Inafecto']) + absNum(r['Valor Facturado Exportación']),
        mtoOperGravadas: absNum(r['BI Gravada']),
        mtoOperExoneradas: absNum(r['Mto Exonerado']),
        mtoOperInafectas: absNum(r['Mto Inafecto']),
        mtoIgv: absNum(r['IGV / IPM']),
        mtoIsc: absNum(r.ISC),
        mtoIcbper: absNum(r.ICBPER),
        totalImpuestos: absNum(r['IGV / IPM']) + absNum(r.ISC) + absNum(r.ICBPER),
        subTotal: absNum(r['BI Gravada']) + absNum(r['Mto Exonerado']) + absNum(r['Mto Inafecto']) + absNum(r['Valor Facturado Exportación']),
        mtoImpVenta: absNum(r['Total CP']),
        moneda: String(r.Moneda || 'PEN').trim() || 'PEN',
        estadoComp: String(r['Est. Comp'] || '').trim(),
      };
    });
}

function buildDetail(row) {
  const base = row.valorVenta || Math.max(0, row.mtoImpVenta - row.totalImpuestos);
  const porcentajeIgv = row.mtoIgv > 0 && row.mtoOperGravadas > 0
    ? Math.round((row.mtoIgv / row.mtoOperGravadas) * 10000) / 100 : 0;
  return [{
    codigo: row.numeroCompleto,
    descripcion: 'Comprobante EB01 (contingencia, emitido manualmente) importado de SUNAT mayo 2026 DOLPHIN',
    unidad: 'NIU', cantidad: 1,
    mto_valor_unitario: Math.round(base * 100) / 100,
    porcentaje_igv: porcentajeIgv,
    tip_afe_igv: row.mtoOperGravadas > 0 ? '10' : row.mtoOperExoneradas > 0 ? '20' : '30',
  }];
}

async function getOrCreateClient(client, row) {
  const existing = await client.query(
    `select id from clients where company_id=$1 and tipo_documento=$2 and numero_documento=$3 limit 1`,
    [COMPANY_ID, row.tipoDocumentoCliente, row.numeroDocumentoCliente]);
  if (existing.rows[0]) return existing.rows[0].id;
  const now = Math.floor(Date.now() / 1000);
  const inserted = await client.query(
    `insert into clients (company_id, tipo_documento, numero_documento, razon_social, activo, created_at, updated_at)
     values ($1,$2,$3,$4,true,$5,$5) returning id`,
    [COMPANY_ID, row.tipoDocumentoCliente, row.numeroDocumentoCliente, row.cliente, now]);
  return inserted.rows[0].id;
}

async function findExisting(client, numeroCompleto) {
  const r = await client.query(
    `select b.id from boletas b join companies c on c.id=b.company_id
     where c.ruc=$1 and b.tipo_documento='03' and b.numero_completo=$2 limit 1`,
    [RUC, numeroCompleto]);
  return r.rows[0] || null;
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
      $19::jsonb,$20::jsonb,$21,$22,'sistema:importacion-sunat-dolphin-eb01-mayo-2026',
      $23,$23
    ) returning id`,
    [
      COMPANY_ID, BRANCH_ID, clientId, row.serie, row.correlativo, row.numeroCompleto,
      row.fechaEmision, row.moneda, row.valorVenta, row.mtoOperGravadas, row.mtoOperExoneradas,
      row.mtoOperInafectas, row.mtoIgv, row.mtoIsc, row.mtoIcbper, row.totalImpuestos,
      row.subTotal, row.mtoImpVenta, JSON.stringify(buildDetail(row)),
      JSON.stringify({ source: 'SUNAT CSV mayo 2026', ruc: RUC, periodo: PERIOD, csvFile: CSV_FILE, contingencia: true, estadoComp: row.estadoComp }),
      estadoSunat, JSON.stringify({ source: 'SUNAT CSV', estadoComp: row.estadoComp }),
      now,
    ]);
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
    for (const row of rows) results.push(await insertBoleta(client, row));
    await client.query('commit');
  } catch (error) { await client.query('rollback'); throw error; }
  finally { client.release(); await pool.end(); }

  writeCsv('registro_eb01_dolphin_mayo.csv', results,
    ['action', 'id', 'numeroCompleto', 'fechaEmision', 'mtoImpVenta', 'cliente', 'estadoComp']);

  const inserted = results.filter((r) => r.action === 'inserted');
  const skipped = results.filter((r) => r.action === 'skip_existing');
  const lines = [
    '# Registro EB01 (contingencia manual) DOLPHIN mayo 2026', '',
    `Generado: ${new Date().toISOString()}`, `RUC: ${RUC} | Company/branch: ${COMPANY_ID}/${BRANCH_ID}`,
    `CSV: \`${CSV_FILE}\``, '',
    '| Resultado | Cantidad | Total |', '| --- | ---: | ---: |',
    `| EB01 en CSV | ${rows.length} | S/ ${money(results.reduce((s, r) => s + Number(r.mtoImpVenta || 0), 0))} |`,
    `| Insertadas | ${inserted.length} | S/ ${money(inserted.reduce((s, r) => s + Number(r.mtoImpVenta || 0), 0))} |`,
    `| Ya existian | ${skipped.length} | S/ ${money(skipped.reduce((s, r) => s + Number(r.mtoImpVenta || 0), 0))} |`,
    '', 'Estas boletas se emitieron manualmente por contingencia (serie EB01) y se importan desde el reporte de SUNAT.',
    '', 'Detalle: `registro_eb01_dolphin_mayo.csv`',
  ];
  fs.writeFileSync(path.join(OUT_DIR, 'registro_eb01_dolphin_mayo.md'), `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
}

main().catch((error) => { console.error(error); process.exit(1); });
