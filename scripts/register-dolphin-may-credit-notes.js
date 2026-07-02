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
    .filter((r) => String(r['Tipo CP/Doc.'] || '').trim().padStart(2, '0') === '07')
    .filter((r) => String(r['Tipo CP Modificado'] || '').trim().padStart(2, '0') === '03')
    .map((r) => {
      const serie = String(r['Serie del CDP'] || '').trim();
      const correlativo = normalizeNumber(r['Nro CP o Doc. Nro Inicial (Rango)']);
      const affectedSerie = String(r['Serie CP Modificado'] || '').trim();
      const affectedCorrelativo = normalizeNumber(r['Nro CP Modificado']);
      return {
        serie, correlativo,
        numeroCompleto: `${serie}-${correlativo}`,
        affectedNumeroCompleto: `${affectedSerie}-${affectedCorrelativo}`,
        fechaEmision: toIsoDate(r['Fecha de emisión']),
        tipoDocumentoCliente: String(r['Tipo Doc Identidad'] || '').trim() || '0',
        numeroDocumentoCliente: String(r['Nro Doc Identidad'] || '').trim() || '-',
        cliente: String(r['Apellidos Nombres/ Razón Social'] || '').trim() || '-',
        tipoNota: String(r['Tipo de Nota'] || '').trim() || '01',
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
    descripcion: `Nota de credito importada de SUNAT mayo 2026 para ${row.affectedNumeroCompleto}`,
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

async function findExistingNote(client, row) {
  const r = await client.query(
    `select cn.id from credit_notes cn join companies c on c.id = cn.company_id
     where c.ruc = $1 and cn.tipo_documento = '07' and cn.numero_completo = $2 limit 1`,
    [RUC, row.numeroCompleto]);
  return r.rows[0] || null;
}

async function findAffectedBoleta(client, row) {
  const r = await client.query(
    `select b.id, b.estado_sunat from boletas b join companies c on c.id = b.company_id
     where c.ruc = $1 and b.tipo_documento = '03' and b.numero_completo = $2 limit 1`,
    [RUC, row.affectedNumeroCompleto]);
  return r.rows[0] || null;
}

async function findExistingNoteForAffected(client, affectedBoletaId) {
  if (!affectedBoletaId) return null;
  const r = await client.query(`select id, numero_completo from credit_notes where affected_boleta_id = $1 limit 1`, [affectedBoletaId]);
  return r.rows[0] || null;
}

const motivo = (row) => (row.tipoNota === '01' ? ['01', 'ANULACION DE LA OPERACION'] : [row.tipoNota, 'NOTA DE CREDITO IMPORTADA DE SUNAT']);

async function insertCreditNote(client, row) {
  const existing = await findExistingNote(client, row);
  if (existing) return { action: 'skip_existing_note', id: existing.id, linked: false, ...row };

  const affected = await findAffectedBoleta(client, row);
  const duplicateForAffected = affected ? await findExistingNoteForAffected(client, affected.id) : null;
  if (duplicateForAffected) {
    return { action: 'skip_affected_already_has_note', id: duplicateForAffected.id, existingNote: duplicateForAffected.numero_completo, linked: true, ...row };
  }

  const clientId = await getOrCreateClient(client, row);
  const now = Math.floor(Date.now() / 1000);
  const [codMotivo, desMotivo] = motivo(row);
  const result = await client.query(
    `insert into credit_notes (
      company_id, branch_id, client_id, affected_boleta_id, tipo_documento, serie, correlativo,
      numero_completo, tipo_doc_afectado, num_doc_afectado, cod_motivo, des_motivo,
      fecha_emision, ubl_version, moneda, forma_pago_tipo,
      valor_venta, mto_oper_gravadas, mto_oper_exoneradas, mto_oper_inafectas,
      mto_oper_gratuitas, mto_igv_gratuitas, mto_igv, mto_base_ivap, mto_ivap,
      mto_isc, mto_icbper, total_impuestos, sub_total, mto_imp_venta,
      detalles, datos_adicionales, estado_sunat, respuesta_sunat, usuario_creacion,
      created_at, updated_at
    ) values (
      $1,$2,$3,$4,'07',$5,$6,
      $7,'03',$8,$9,$10,
      $11,'2.1',$12,'Contado',
      $13,$14,$15,$16,
      '0','0',$17,'0','0',
      $18,$19,$20,$21,$22,
      $23::jsonb,$24::jsonb,'ACEPTADO',$25,'sistema:importacion-sunat-dolphin-notas-mayo-2026',
      $26,$26
    ) returning id`,
    [
      COMPANY_ID, BRANCH_ID, clientId, affected?.id || null, row.serie, row.correlativo,
      row.numeroCompleto, row.affectedNumeroCompleto, codMotivo, desMotivo,
      row.fechaEmision, row.moneda, row.valorVenta, row.mtoOperGravadas, row.mtoOperExoneradas,
      row.mtoOperInafectas, row.mtoIgv, row.mtoIsc, row.mtoIcbper, row.totalImpuestos,
      row.subTotal, row.mtoImpVenta, JSON.stringify(buildDetail(row)),
      JSON.stringify({ source: 'SUNAT CSV mayo 2026', ruc: RUC, periodo: PERIOD, csvFile: CSV_FILE, affectedFound: Boolean(affected) }),
      JSON.stringify({ source: 'SUNAT CSV', estadoComp: row.estadoComp }),
      now,
    ]);
  if (affected?.id) {
    await client.query(`update boletas set estado_sunat = 'ANULADO', updated_at = $2 where id = $1`, [affected.id, now]);
  }
  return { action: affected ? 'inserted' : 'inserted_unlinked', id: result.rows[0].id, linked: Boolean(affected), ...row };
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
    for (const row of rows) results.push(await insertCreditNote(client, row));
    await client.query('commit');
  } catch (error) { await client.query('rollback'); throw error; }
  finally { client.release(); await pool.end(); }

  const columns = ['action', 'id', 'existingNote', 'numeroCompleto', 'fechaEmision', 'mtoImpVenta', 'affectedNumeroCompleto', 'linked', 'cliente'];
  writeCsv('registro_notas_credito_dolphin_mayo.csv', results, columns);

  const total = (items) => items.reduce((s, r) => s + Number(r.mtoImpVenta || 0), 0);
  const grouped = new Map();
  for (const row of results) {
    const cur = grouped.get(row.action) || { action: row.action, count: 0, total: 0 };
    cur.count += 1; cur.total += Number(row.mtoImpVenta || 0); grouped.set(row.action, cur);
  }
  const lines = [
    '# Registro notas de credito DOLPHIN mayo 2026', '',
    `Generado: ${new Date().toISOString()}`, `RUC: ${RUC}`, `CSV: \`${CSV_FILE}\``, '',
    '| Resultado | Cantidad | Total |', '| --- | ---: | ---: |',
    `| Notas en CSV que afectan boletas (03) | ${rows.length} | S/ ${money(total(rows))} |`,
    ...Array.from(grouped.values()).map((r) => `| ${r.action} | ${r.count} | S/ ${money(r.total)} |`),
    '', 'Las B001 se enlazan a su boleta (que pasa a ANULADO); las EB01 sin boleta en el sistema quedan sin enlace.',
    '', 'Detalle: `registro_notas_credito_dolphin_mayo.csv`',
  ];
  fs.writeFileSync(path.join(OUT_DIR, 'registro_notas_credito_dolphin_mayo.md'), `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
}

main().catch((error) => { console.error(error); process.exit(1); });
