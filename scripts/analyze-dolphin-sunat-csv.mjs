import { readFileSync } from 'node:fs';
import pg from 'pg';

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: node scripts/analyze-dolphin-sunat-csv.mjs <sunat-csv>');
  process.exit(1);
}

function loadEnv() {
  const text = readFileSync('.env', 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx);
    const value = trimmed.slice(idx + 1);
    if (!process.env[key]) process.env[key] = value;
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (c === '"' && next === '"') {
        value += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        value += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(value);
      value = '';
    } else if (c === '\n') {
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else if (c !== '\r') {
      value += c;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  const headers = rows.shift().map((header) => header.replace(/^\uFEFF/, '').trim());
  return rows
    .filter((cells) => cells.some((cell) => String(cell).trim()))
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])));
}

function money(value) {
  return Number(value || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function docNumber(row) {
  return `${row['Serie del CDP']}-${String(row['Nro CP o Doc. Nro Inicial (Rango)']).padStart(6, '0')}`;
}

function toNum(value) {
  return Number(String(value || '0').replace(',', '.')) || 0;
}

function dateToIso(date) {
  const parts = String(date || '').split('/');
  if (parts.length !== 3) return '';
  const [dd, mm, yyyy] = parts;
  return `${yyyy.padStart(4, '20')}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

function monthOfIso(iso) {
  return String(iso || '').slice(0, 7) || 'sin-fecha';
}

function createdAtIso(ms) {
  if (!ms) return '';
  return new Date(Number(ms)).toISOString().slice(0, 10);
}

loadEnv();
const connectionString = process.env.DATABASE_URL_POSTGRES;
if (!connectionString) {
  console.error('Missing DATABASE_URL_POSTGRES');
  process.exit(1);
}

const rows = parseCsv(readFileSync(csvPath, 'utf8'));
const ruc = rows[0]?.Ruc || '20612600563';
const sunatBoletas = rows
  .filter((row) => String(row['Tipo CP/Doc.']).padStart(2, '0') === '03')
  .map((row) => ({
    ...row,
    numeroCompleto: docNumber(row),
    serie: row['Serie del CDP'],
    correlativo: String(row['Nro CP o Doc. Nro Inicial (Rango)']).padStart(6, '0'),
    total: toNum(row['Total CP']),
    fechaIso: dateToIso(row['Fecha de emisión']),
  }));
const sunatNotas = rows
  .filter((row) => String(row['Tipo CP/Doc.']).padStart(2, '0') === '07')
  .map((row) => ({
    ...row,
    numeroCompleto: docNumber(row),
    affected: `${row['Serie CP Modificado']}-${String(row['Nro CP Modificado']).padStart(6, '0')}`,
    total: toNum(row['Total CP']),
    fechaIso: dateToIso(row['Fecha de emisión']),
  }));

const { Pool } = pg;
const pool = new Pool({ connectionString });
try {
  const companyResult = await pool.query(
    `select id, ruc, razon_social from companies where ruc = $1 limit 1`,
    [ruc],
  );
  const company = companyResult.rows[0];
  if (!company) throw new Error(`No existe empresa con RUC ${ruc}`);

  const systemResult = await pool.query(
    `
      select
        b.id,
        b.serie,
        b.correlativo,
        b.numero_completo as "numeroCompleto",
        b.order_number as "orderNumber",
        b.fecha_emision as "fechaEmision",
        b.mto_imp_venta as "total",
        b.estado_sunat as "estadoSunat",
        b.created_at as "createdAt",
        c.tipo_documento as "clientTipoDoc",
        c.numero_documento as "clientDoc",
        c.razon_social as "clientName",
        cn.numero_completo as "notaCredito",
        cn.fecha_emision as "notaFecha",
        cn.estado_sunat as "notaEstado",
        cn.mto_imp_venta as "notaTotal"
      from boletas b
      left join clients c on c.id = b.client_id
      left join credit_notes cn on cn.affected_boleta_id = b.id
      where b.company_id = $1
        and b.tipo_documento = '03'
        and (b.fecha_emision >= '2026-06-01' and b.fecha_emision <= '2026-06-30')
      order by b.serie, b.correlativo
    `,
    [company.id],
  );

  const allSystemResult = await pool.query(
    `
      select
        b.id,
        b.serie,
        b.correlativo,
        b.numero_completo as "numeroCompleto",
        b.order_number as "orderNumber",
        b.fecha_emision as "fechaEmision",
        b.mto_imp_venta as "total",
        b.estado_sunat as "estadoSunat",
        b.created_at as "createdAt",
        c.numero_documento as "clientDoc",
        c.razon_social as "clientName",
        cn.numero_completo as "notaCredito",
        cn.fecha_emision as "notaFecha",
        cn.estado_sunat as "notaEstado"
      from boletas b
      left join clients c on c.id = b.client_id
      left join credit_notes cn on cn.affected_boleta_id = b.id
      where b.company_id = $1
        and b.tipo_documento = '03'
      order by b.fecha_emision, b.serie, b.correlativo
    `,
    [company.id],
  );

  const sunatByDoc = new Map(sunatBoletas.map((row) => [row.numeroCompleto, row]));
  const systemByDoc = new Map(allSystemResult.rows.map((row) => [row.numeroCompleto, row]));
  const matched = sunatBoletas.map((sunat) => ({ sunat, system: systemByDoc.get(sunat.numeroCompleto) || null }));
  const missingInSystem = matched.filter((row) => !row.system);
  const systemJune = systemResult.rows;
  const systemNotInSunat = systemJune.filter((row) => !sunatByDoc.has(row.numeroCompleto));
  const matchedSystem = matched.filter((row) => row.system);
  const withOrder = matchedSystem.filter((row) => row.system.orderNumber);
  const withoutOrder = matchedSystem.filter((row) => !row.system.orderNumber);
  const withCreditNote = matchedSystem.filter((row) => row.system.notaCredito);

  const bySerie = {};
  for (const row of sunatBoletas) {
    bySerie[row.serie] ||= { count: 0, total: 0 };
    bySerie[row.serie].count += 1;
    bySerie[row.serie].total += row.total;
  }

  const systemByOrigin = {
    falabella: systemJune.filter((row) => row.orderNumber).length,
    manualOrNoOrder: systemJune.filter((row) => !row.orderNumber).length,
  };

  const byOrderMonth = {};
  for (const row of systemJune) {
    const key = row.orderNumber ? monthOfIso(createdAtIso(row.createdAt)) : 'sin-orderNumber';
    byOrderMonth[key] ||= { count: 0, total: 0 };
    byOrderMonth[key].count += 1;
    byOrderMonth[key].total += Number(row.total || 0);
  }

  const sunatNotesByAffected = new Map();
  for (const note of sunatNotas) {
    const current = sunatNotesByAffected.get(note.affected) || [];
    current.push(note);
    sunatNotesByAffected.set(note.affected, current);
  }

  const payload = {
    empresa: company,
    archivo: csvPath,
    resumen: {
      sunatBoletas: sunatBoletas.length,
      sunatBoletasTotal: sunatBoletas.reduce((sum, row) => sum + row.total, 0),
      sunatNotasCredito: sunatNotas.length,
      sunatNotasCreditoTotal: sunatNotas.reduce((sum, row) => sum + row.total, 0),
      sistemaBoletasJunio: systemJune.length,
      sistemaBoletasJunioTotal: systemJune.reduce((sum, row) => sum + Number(row.total || 0), 0),
      sunatEncontradasEnSistema: matchedSystem.length,
      sunatNoEncontradasEnSistema: missingInSystem.length,
      sistemaJunioNoEstaEnSunatCsv: systemNotInSunat.length,
      sunatConOrderNumberFalabella: withOrder.length,
      sunatSinOrderNumber: withoutOrder.length,
      sunatConNotaCreditoEnSistema: withCreditNote.length,
    },
    porSerieSunat: bySerie,
    origenSistemaJunio: systemByOrigin,
    sistemaJunioPorFechaRegistro: byOrderMonth,
    sunatNoEncontradasEnSistema: missingInSystem.map(({ sunat }) => ({
      comprobante: sunat.numeroCompleto,
      fecha: sunat.fechaIso,
      total: sunat.total,
      clienteDoc: sunat['Nro Doc Identidad'],
      cliente: sunat['Apellidos Nombres/ Razón Social'],
    })),
    sistemaJunioNoEstaEnSunatCsv: systemNotInSunat.map((row) => ({
      comprobante: row.numeroCompleto,
      fecha: row.fechaEmision,
      total: Number(row.total || 0),
      estado: row.estadoSunat,
      orderNumber: row.orderNumber,
      clienteDoc: row.clientDoc,
      cliente: row.clientName,
      notaCredito: row.notaCredito,
    })),
    detalleSunat: matched.map(({ sunat, system }) => ({
      comprobante: sunat.numeroCompleto,
      fechaSunat: sunat.fechaIso,
      totalSunat: sunat.total,
      enSistema: Boolean(system),
      orderNumber: system?.orderNumber || '',
      origen: system?.orderNumber ? 'Falabella / Seller Center' : system ? 'Sistema sin orderNumber' : 'Solo SUNAT CSV',
      fechaSistema: system?.fechaEmision || '',
      totalSistema: system ? Number(system.total || 0) : null,
      estadoSistema: system?.estadoSunat || '',
      clienteDocSistema: system?.clientDoc || '',
      clienteSistema: system?.clientName || '',
      notaCreditoSistema: system?.notaCredito || '',
      notaCreditoSunat: (sunatNotesByAffected.get(sunat.numeroCompleto) || []).map((note) => note.numeroCompleto).join(', '),
    })),
  };

  console.log(JSON.stringify(payload, null, 2));
} finally {
  await pool.end();
}
