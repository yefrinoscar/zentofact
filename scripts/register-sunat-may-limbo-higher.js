require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const INPUT = process.argv[2] || '/Users/ylaurach/Downloads/LE206078091362026060014040001EXP2.csv';
const OUT_DIR = path.resolve(process.cwd(), 'reports', 'sunat-mayo-2026-limbo-higher');
const RUC = '20607809136';
const PERIOD = '202605';
const COMPANY_ID = 1;
const BRANCH_ID = 1;

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

function normalizeHeader(value) {
  return String(value || '').replace(/^\uFEFF/, '').trim();
}

function toIsoDate(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return text;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function normalizeNumber(value) {
  const digits = String(value || '').trim().replace(/\D/g, '');
  return digits.padStart(6, '0');
}

function num(value) {
  const n = Number(String(value || '0').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function absNum(value) {
  return Math.abs(num(value));
}

function money(value) {
  return Number(value || 0).toLocaleString('es-PE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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

function parseRows() {
  const raw = fs.readFileSync(INPUT, 'utf8');
  const table = parseCsv(raw);
  const headers = table[0].map(normalizeHeader);
  return table.slice(1)
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] || ''])))
    .filter((row) => String(row.Ruc).trim() === RUC && String(row.Periodo).trim() === PERIOD)
    .map((row) => {
      const tipo = String(row['Tipo CP/Doc.'] || '').trim().padStart(2, '0');
      const serie = String(row['Serie del CDP'] || '').trim();
      const correlativo = normalizeNumber(row['Nro CP o Doc. Nro Inicial (Rango)']);
      const modifiedTipoRaw = String(row['Tipo CP Modificado'] || '').trim();
      const modifiedTipo = modifiedTipoRaw ? modifiedTipoRaw.padStart(2, '0') : '';
      const modifiedSerie = String(row['Serie CP Modificado'] || '').trim();
      const modifiedCorrelativo = normalizeNumber(row['Nro CP Modificado']);
      const total = num(row['Total CP']);
      return {
        tipo,
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
        tipoNota: String(row['Tipo de Nota'] || '').trim(),
        modifiedTipo,
        modifiedNumeroCompleto: modifiedSerie && modifiedCorrelativo ? `${modifiedSerie}-${modifiedCorrelativo}` : '',
      };
    });
}

function buildDetail(row) {
  const base = row.valorVenta || Math.max(0, row.mtoImpVenta - row.totalImpuestos);
  const tipAfeIgv = row.mtoOperGravadas > 0 ? '10' : row.mtoOperExoneradas > 0 ? '20' : '30';
  const porcentajeIgv = row.mtoIgv > 0 && row.mtoOperGravadas > 0
    ? Math.round((row.mtoIgv / row.mtoOperGravadas) * 10000) / 100
    : 0;
  return [{
    codigo: row.numeroCompleto,
    descripcion: `Comprobante importado de SUNAT ${PERIOD}`,
    unidad: 'NIU',
    cantidad: 1,
    mto_valor_unitario: Math.round(base * 100) / 100,
    porcentaje_igv: porcentajeIgv,
    tip_afe_igv: tipAfeIgv,
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

async function findDocumentByRuc(client, table, tipo, numeroCompleto) {
  const query = table === 'boletas'
    ? `select b.id, b.company_id from boletas b join companies c on c.id=b.company_id where c.ruc=$1 and b.tipo_documento=$2 and b.numero_completo=$3 limit 1`
    : `select cn.id, cn.company_id from credit_notes cn join companies c on c.id=cn.company_id where c.ruc=$1 and cn.tipo_documento=$2 and cn.numero_completo=$3 limit 1`;
  const result = await client.query(query, [RUC, tipo, numeroCompleto]);
  return result.rows[0] || null;
}

async function findAffectedBoleta(client, numeroCompleto) {
  const result = await client.query(
    `select b.id, b.company_id from boletas b join companies c on c.id=b.company_id where c.ruc=$1 and b.tipo_documento='03' and b.numero_completo=$2 limit 1`,
    [RUC, numeroCompleto],
  );
  return result.rows[0] || null;
}

async function insertBoleta(client, row) {
  const existing = await findDocumentByRuc(client, 'boletas', '03', row.numeroCompleto);
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
      $19::jsonb,$20::jsonb,$21,$22,'sistema:importacion-sunat-mayo-2026',
      $23,$23
    ) returning id`,
    [
      COMPANY_ID, BRANCH_ID, clientId, row.serie, row.correlativo, row.numeroCompleto,
      row.fechaEmision, row.moneda, row.valorVenta, row.mtoOperGravadas, row.mtoOperExoneradas,
      row.mtoOperInafectas, row.mtoIgv, row.mtoIsc, row.mtoIcbper, row.totalImpuestos,
      row.subTotal, row.mtoImpVenta, JSON.stringify(buildDetail(row)),
      JSON.stringify({ source: 'SUNAT CSV mayo 2026', ruc: RUC, periodo: PERIOD, estadoComp: row.estadoComp }),
      estadoSunat, JSON.stringify({ source: 'SUNAT CSV', estadoComp: row.estadoComp }),
      now,
    ],
  );
  return { action: 'inserted', id: result.rows[0].id, ...row };
}

async function insertCreditNote(client, row) {
  const existing = await findDocumentByRuc(client, 'credit_notes', '07', row.numeroCompleto);
  if (existing) return { action: 'skip_existing', id: existing.id, linked: false, ...row };

  const affected = row.modifiedTipo === '03' && row.modifiedNumeroCompleto
    ? await findAffectedBoleta(client, row.modifiedNumeroCompleto)
    : null;
  const clientId = await getOrCreateClient(client, row);
  const now = Math.floor(Date.now() / 1000);
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
      $7,$8,$9,$10,$11,
      $12,'2.1',$13,'Contado',
      $14,$15,$16,$17,
      '0','0',$18,'0','0',
      $19,$20,$21,$22,$23,
      $24::jsonb,$25::jsonb,'ACEPTADO',$26,'sistema:importacion-sunat-mayo-2026',
      $27,$27
    ) returning id`,
    [
      COMPANY_ID, BRANCH_ID, clientId, affected?.id || null, row.serie, row.correlativo,
      row.numeroCompleto, row.modifiedTipo, row.modifiedNumeroCompleto, row.tipoNota || '01',
      row.tipoNota === '01' ? 'ANULACION DE LA OPERACION' : 'NOTA DE CREDITO IMPORTADA DE SUNAT',
      row.fechaEmision, row.moneda, row.valorVenta, row.mtoOperGravadas, row.mtoOperExoneradas,
      row.mtoOperInafectas, row.mtoIgv, row.mtoIsc, row.mtoIcbper, row.totalImpuestos,
      row.subTotal, row.mtoImpVenta, JSON.stringify(buildDetail(row)),
      JSON.stringify({ source: 'SUNAT CSV mayo 2026', ruc: RUC, periodo: PERIOD, affectedFound: Boolean(affected) }),
      JSON.stringify({ source: 'SUNAT CSV', estadoComp: row.estadoComp }),
      now,
    ],
  );
  if (affected?.id) {
    await client.query(`update boletas set estado_sunat='ANULADO', updated_at=$2 where id=$1`, [affected.id, now]);
  }
  return { action: 'inserted', id: result.rows[0].id, linked: Boolean(affected), ...row };
}

function count(rows, action) {
  return rows.filter((row) => row.action === action).length;
}

function sum(rows) {
  return rows.reduce((acc, row) => acc + Number(row.mtoImpVenta || 0), 0);
}

async function main() {
  if (!process.env.DATABASE_URL_POSTGRES) throw new Error('Missing DATABASE_URL_POSTGRES');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const rows = parseRows();
  const boletaRows = rows.filter((row) => row.tipo === '03');
  const creditNoteRowsForBoletas = rows.filter((row) => row.tipo === '07' && row.modifiedTipo === '03');
  const creditNoteRowsForInvoices = rows.filter((row) => row.tipo === '07' && row.modifiedTipo === '01');
  const facturaRows = rows.filter((row) => row.tipo === '01');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL_POSTGRES });
  const client = await pool.connect();
  const boletaResults = [];
  const noteResults = [];

  try {
    await client.query('begin');
    for (const row of boletaRows) {
      boletaResults.push(await insertBoleta(client, row));
    }
    for (const row of creditNoteRowsForBoletas) {
      noteResults.push(await insertCreditNote(client, row));
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
    'action', 'id', 'tipo', 'numeroCompleto', 'fechaEmision', 'mtoImpVenta',
    'cliente', 'tipoDocumentoCliente', 'numeroDocumentoCliente', 'estadoComp',
    'modifiedTipo', 'modifiedNumeroCompleto', 'linked',
  ];
  writeCsv('registro_boletas.csv', boletaResults, columns);
  writeCsv('registro_notas_boleta.csv', noteResults, columns);
  writeCsv('facturas_no_registradas.csv', facturaRows, columns);
  writeCsv('notas_factura_no_registradas.csv', creditNoteRowsForInvoices, columns);

  const lines = [];
  lines.push('# Registro SUNAT mayo 2026 - Limbo / Higher');
  lines.push('');
  lines.push(`Archivo SUNAT: \`${INPUT}\``);
  lines.push(`RUC: \`${RUC}\``);
  lines.push(`Periodo: \`${PERIOD}\``);
  lines.push(`Empresa usada para importacion: company_id=${COMPANY_ID}, branch_id=${BRANCH_ID} (Limbo principal).`);
  lines.push(`Generado: ${new Date().toLocaleString('sv-SE', { timeZone: 'America/Lima' })} America/Lima`);
  lines.push('');
  lines.push('## Registro Ejecutado');
  lines.push('');
  lines.push('| Documento | En CSV | Insertados | Ya existian | Total registrado/ya existente |');
  lines.push('|---|---:|---:|---:|---:|');
  lines.push(`| Boletas 03 | ${boletaRows.length} | ${count(boletaResults, 'inserted')} | ${count(boletaResults, 'skip_existing')} | S/ ${money(sum(boletaResults))} |`);
  lines.push(`| Notas 07 que afectan boletas | ${creditNoteRowsForBoletas.length} | ${count(noteResults, 'inserted')} | ${count(noteResults, 'skip_existing')} | S/ ${money(sum(noteResults))} |`);
  lines.push('');
  lines.push(`Notas enlazadas a boleta local: ${noteResults.filter((row) => row.linked).length}`);
  lines.push(`Notas registradas sin boleta local afectada: ${noteResults.filter((row) => row.action === 'inserted' && !row.linked).length}`);
  lines.push('');
  lines.push('## No Registrado Por Pedido');
  lines.push('');
  lines.push(`- Facturas 01 en SUNAT: ${facturaRows.length}, total S/ ${money(sum(facturaRows))}.`);
  lines.push(`- Notas 07 que afectan facturas 01: ${creditNoteRowsForInvoices.length}, total S/ ${money(sum(creditNoteRowsForInvoices))}.`);
  lines.push('');
  lines.push('## Facturas En El CSV');
  lines.push('');
  lines.push('| Factura | Fecha | Total | Cliente |');
  lines.push('|---|---|---:|---|');
  for (const row of facturaRows) {
    lines.push(`| ${row.numeroCompleto} | ${row.fechaEmision} | S/ ${money(row.mtoImpVenta)} | ${row.cliente.replace(/\|/g, '/')} |`);
  }
  lines.push('');
  lines.push('## Notas De Credito Para Facturas No Registradas');
  lines.push('');
  if (!creditNoteRowsForInvoices.length) {
    lines.push('No hay notas que afecten facturas.');
  } else {
    lines.push('| Nota | Fecha | Total | Factura afectada | Cliente |');
    lines.push('|---|---|---:|---|---|');
    for (const row of creditNoteRowsForInvoices) {
      lines.push(`| ${row.numeroCompleto} | ${row.fechaEmision} | S/ ${money(row.mtoImpVenta)} | ${row.modifiedNumeroCompleto} | ${row.cliente.replace(/\|/g, '/')} |`);
    }
  }
  lines.push('');
  lines.push('## Archivos De Detalle');
  lines.push('');
  lines.push('- `registro_boletas.csv`');
  lines.push('- `registro_notas_boleta.csv`');
  lines.push('- `facturas_no_registradas.csv`');
  lines.push('- `notas_factura_no_registradas.csv`');
  lines.push('');

  fs.writeFileSync(path.join(OUT_DIR, 'registro_reporte.md'), `${lines.join('\n')}\n`);
  console.log(JSON.stringify({
    outDir: OUT_DIR,
    boletas: { csv: boletaRows.length, inserted: count(boletaResults, 'inserted'), existing: count(boletaResults, 'skip_existing') },
    notasBoleta: {
      csv: creditNoteRowsForBoletas.length,
      inserted: count(noteResults, 'inserted'),
      existing: count(noteResults, 'skip_existing'),
      linked: noteResults.filter((row) => row.linked).length,
    },
    facturasNoRegistradas: facturaRows.length,
    notasFacturaNoRegistradas: creditNoteRowsForInvoices.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
