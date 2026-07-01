require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const INPUT = process.argv[2] || '/Users/ylaurach/Downloads/LE206078091362026060014040001EXP2.csv';
const OUT_DIR = path.resolve(process.cwd(), 'reports', 'sunat-mayo-2026-limbo-higher');
const RUC = '20607809136';
const PERIOD = '202605';

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

function numeroCompleto(serie, numero) {
  return `${String(serie || '').trim()}-${normalizeNumber(numero)}`;
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

function sum(rows, key = 'total') {
  return rows.reduce((acc, row) => acc + Number(row[key] || 0), 0);
}

function groupBySeries(rows) {
  const groups = new Map();
  for (const row of rows) {
    const current = groups.get(row.serie) || { serie: row.serie, count: 0, total: 0 };
    current.count++;
    current.total += Number(row.total || 0);
    groups.set(row.serie, current);
  }
  return Array.from(groups.values()).sort((a, b) => a.serie.localeCompare(b.serie));
}

function kindFromType(type) {
  if (type === '03') return 'boletas';
  if (type === '07') return 'notas';
  if (type === '01') return 'facturas';
  return 'otros';
}

function sellerBucket(row) {
  const text = `${row.company_nombre || ''} ${row.seller_username || ''}`.toUpperCase();
  return text.includes('HIGHER') ? 'Higher' : 'Limbo';
}

async function main() {
  if (!process.env.DATABASE_URL_POSTGRES) {
    throw new Error('Missing DATABASE_URL_POSTGRES');
  }

  const raw = fs.readFileSync(INPUT, 'utf8');
  const table = parseCsv(raw);
  const headers = table[0].map(normalizeHeader);
  const rows = table.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] || ''])));

  const sunatRows = rows
    .filter((row) => String(row.Ruc).trim() === RUC && String(row.Periodo).trim() === PERIOD)
    .map((row) => {
      const tipo = String(row['Tipo CP/Doc.'] || '').trim().padStart(2, '0');
      const serie = String(row['Serie del CDP'] || '').trim();
      const numero = normalizeNumber(row['Nro CP o Doc. Nro Inicial (Rango)']);
      const modifiedTipo = String(row['Tipo CP Modificado'] || '').trim().padStart(2, '0');
      const modifiedSerie = String(row['Serie CP Modificado'] || '').trim();
      const modifiedNumero = normalizeNumber(row['Nro CP Modificado']);
      return {
        tipo,
        kind: kindFromType(tipo),
        serie,
        numero,
        numeroCompleto: `${serie}-${numero}`,
        fechaEmision: toIsoDate(row['Fecha de emisión']),
        clienteDoc: String(row['Nro Doc Identidad'] || '').trim(),
        cliente: String(row['Apellidos Nombres/ Razón Social'] || '').trim(),
        total: Number(row['Total CP'] || 0),
        estado: String(row['Est. Comp'] || '').trim(),
        tipoNota: String(row['Tipo de Nota'] || '').trim(),
        modifiedTipo: modifiedTipo === '00' ? '' : modifiedTipo,
        modifiedNumeroCompleto: modifiedSerie && modifiedNumero ? `${modifiedSerie}-${modifiedNumero}` : '',
      };
    });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL_POSTGRES });
  const dbRows = [];

  const boletas = await pool.query(`
    select '03' as tipo, b.numero_completo, b.fecha_emision, b.estado_sunat as estado,
      b.mto_imp_venta::numeric as total, b.order_number, c.id as company_id,
      c.nombre as company_nombre, c.razon_social, c.seller_username
    from boletas b
    join companies c on c.id = b.company_id
    where c.ruc = $1
  `, [RUC]);
  const notas = await pool.query(`
    select '07' as tipo, cn.numero_completo, cn.fecha_emision, cn.estado_sunat as estado,
      cn.mto_imp_venta::numeric as total, null::text as order_number, c.id as company_id,
      c.nombre as company_nombre, c.razon_social, c.seller_username,
      cn.num_doc_afectado as affected_document
    from credit_notes cn
    join companies c on c.id = cn.company_id
    where c.ruc = $1
  `, [RUC]);
  const facturas = await pool.query(`
    select '01' as tipo, f.numero_completo, f.fecha_emision, f.estado,
      null::numeric as total, f.order_number, c.id as company_id,
      c.nombre as company_nombre, c.razon_social, c.seller_username
    from facturas f
    join companies c on c.id = f.company_id
    where c.ruc = $1
  `, [RUC]);

  dbRows.push(...boletas.rows, ...notas.rows, ...facturas.rows);
  await pool.end();

  const dbByKey = new Map();
  for (const row of dbRows) {
    const key = `${row.tipo}|${row.numero_completo}`;
    const list = dbByKey.get(key) || [];
    list.push(row);
    dbByKey.set(key, list);
  }

  const results = sunatRows.map((row) => {
    const matches = dbByKey.get(`${row.tipo}|${row.numeroCompleto}`) || [];
    const first = matches[0];
    return {
      ...row,
      found: matches.length > 0 ? 'SI' : 'NO',
      matchCount: matches.length,
      bucket: first ? sellerBucket(first) : '',
      dbCompanyId: first?.company_id || '',
      dbCompany: first?.company_nombre || '',
      dbSeller: first?.seller_username || '',
      dbEstado: first?.estado || '',
      dbFechaEmision: first?.fecha_emision || '',
      dbTotal: first?.total == null ? '' : Number(first.total),
      dbOrderNumber: first?.order_number || '',
      dbAffectedDocument: first?.affected_document || '',
    };
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const byKind = {};
  for (const kind of ['boletas', 'notas', 'facturas', 'otros']) {
    const kindRows = results.filter((row) => row.kind === kind);
    byKind[kind] = {
      all: kindRows,
      found: kindRows.filter((row) => row.found === 'SI'),
      missing: kindRows.filter((row) => row.found === 'NO'),
    };
  }

  const detailColumns = [
    'tipo', 'numeroCompleto', 'fechaEmision', 'total', 'estado', 'clienteDoc', 'cliente',
    'found', 'bucket', 'dbCompanyId', 'dbCompany', 'dbSeller', 'dbEstado', 'dbFechaEmision',
    'dbTotal', 'dbOrderNumber', 'tipoNota', 'modifiedTipo', 'modifiedNumeroCompleto', 'dbAffectedDocument',
  ];

  writeCsv('sunat_mayo_todo_con_match.csv', results, detailColumns);
  for (const kind of ['boletas', 'notas', 'facturas']) {
    writeCsv(`${kind}_encontradas.csv`, byKind[kind].found, detailColumns);
    writeCsv(`${kind}_nuevas.csv`, byKind[kind].missing, detailColumns);
  }

  const duplicateSunat = [];
  const sunatCountByKey = new Map();
  for (const row of sunatRows) {
    const key = `${row.tipo}|${row.numeroCompleto}`;
    sunatCountByKey.set(key, (sunatCountByKey.get(key) || 0) + 1);
  }
  for (const [key, count] of sunatCountByKey) {
    if (count > 1) duplicateSunat.push({ key, count });
  }

  const lines = [];
  lines.push('# Cruce SUNAT mayo 2026 - Limbo / Higher');
  lines.push('');
  lines.push(`Archivo SUNAT: \`${INPUT}\``);
  lines.push(`RUC: \`${RUC}\``);
  lines.push(`Periodo: \`${PERIOD}\``);
  lines.push(`Generado: ${new Date().toLocaleString('sv-SE', { timeZone: 'America/Lima' })} America/Lima`);
  lines.push('');
  lines.push('## Resumen');
  lines.push('');
  lines.push('| Tipo | SUNAT | En DB | Nuevas/no encontradas | Total SUNAT | Total en DB | Total nuevas |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  for (const [label, kind] of [['Boletas 03', 'boletas'], ['Notas 07', 'notas'], ['Facturas 01', 'facturas'], ['Otros', 'otros']]) {
    const group = byKind[kind];
    if (!group.all.length && kind === 'otros') continue;
    lines.push(`| ${label} | ${group.all.length} | ${group.found.length} | ${group.missing.length} | S/ ${money(sum(group.all))} | S/ ${money(sum(group.found))} | S/ ${money(sum(group.missing))} |`);
  }
  lines.push('');

  lines.push('## Separación Interna De Encontrados');
  lines.push('');
  lines.push('| Tipo | Limbo | Higher | Sin clasificar |');
  lines.push('|---|---:|---:|---:|');
  for (const [label, kind] of [['Boletas 03', 'boletas'], ['Notas 07', 'notas'], ['Facturas 01', 'facturas']]) {
    const found = byKind[kind].found;
    lines.push(`| ${label} | ${found.filter((row) => row.bucket === 'Limbo').length} | ${found.filter((row) => row.bucket === 'Higher').length} | ${found.filter((row) => !row.bucket).length} |`);
  }
  lines.push('');

  lines.push('## Desglose Por Serie');
  lines.push('');
  lines.push('| Tipo | Estado cruce | Serie | Cantidad | Total SUNAT |');
  lines.push('|---|---|---|---:|---:|');
  for (const [label, kind] of [['Boletas 03', 'boletas'], ['Notas 07', 'notas'], ['Facturas 01', 'facturas']]) {
    for (const [stateLabel, rowsForState] of [['En DB', byKind[kind].found], ['Nuevas/no encontradas', byKind[kind].missing]]) {
      for (const group of groupBySeries(rowsForState)) {
        lines.push(`| ${label} | ${stateLabel} | ${group.serie} | ${group.count} | S/ ${money(group.total)} |`);
      }
    }
  }
  lines.push('');

  lines.push('## Archivos De Detalle');
  lines.push('');
  lines.push('- `sunat_mayo_todo_con_match.csv`: todos los comprobantes SUNAT con columnas de match.');
  lines.push('- `boletas_encontradas.csv` / `boletas_nuevas.csv`');
  lines.push('- `notas_encontradas.csv` / `notas_nuevas.csv`');
  lines.push('- `facturas_encontradas.csv` / `facturas_nuevas.csv`');
  lines.push('');

  if (duplicateSunat.length) {
    lines.push('## Duplicados En SUNAT');
    lines.push('');
    for (const duplicate of duplicateSunat) lines.push(`- ${duplicate.key}: ${duplicate.count}`);
    lines.push('');
  }

  for (const [title, kind] of [['Boletas Nuevas', 'boletas'], ['Notas Nuevas', 'notas'], ['Facturas Nuevas', 'facturas']]) {
    const rowsToShow = byKind[kind].missing.slice(0, 25);
    lines.push(`## ${title} - Primeros ${rowsToShow.length}`);
    lines.push('');
    if (!rowsToShow.length) {
      lines.push('No hay registros nuevos.');
      lines.push('');
      continue;
    }
    lines.push('| Comprobante | Fecha | Total | Cliente | Doc afectado |');
    lines.push('|---|---|---:|---|---|');
    for (const row of rowsToShow) {
      lines.push(`| ${row.numeroCompleto} | ${row.fechaEmision} | S/ ${money(row.total)} | ${row.cliente.replace(/\|/g, '/')} | ${row.modifiedNumeroCompleto || ''} |`);
    }
    lines.push('');
  }

  fs.writeFileSync(path.join(OUT_DIR, 'reporte.md'), `${lines.join('\n')}\n`);

  console.log(JSON.stringify({
    outDir: OUT_DIR,
    resumen: Object.fromEntries(Object.entries(byKind).map(([kind, group]) => [kind, {
      sunat: group.all.length,
      found: group.found.length,
      missing: group.missing.length,
      total: Number(sum(group.all).toFixed(2)),
      foundTotal: Number(sum(group.found).toFixed(2)),
      missingTotal: Number(sum(group.missing).toFixed(2)),
    }])),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
