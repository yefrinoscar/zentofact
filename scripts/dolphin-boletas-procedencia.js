require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const RUC = '20612600563';
const COMPANY_ID = 2;
const OUT_DIR = path.resolve('reports/dolphin-mayo-2026');

const CSVS = {
  ABRIL: ['/Users/ylaurach/Library/CloudStorage/OneDrive2-Personal/zentoo/SELLERS/DOLPHIN/ABRIL/LE206126005632026060014040001EXP2.csv'],
  MAYO: ['/private/tmp/claude-501/-Users-ylaurach-Documents-repos-p-zentofact/663d2872-311e-4885-a7f7-94aa1b9b17c7/scratchpad/dolphin/LE206126005632026060014040001EXP2.csv'],
  JUNIO: [
    '/Users/ylaurach/Library/CloudStorage/OneDrive2-Personal/zentoo/SELLERS/DOLPHIN/JUNIO/21:06:2026/LE206126005632026060014040001EXP2.csv',
    '/Users/ylaurach/Library/CloudStorage/OneDrive2-Personal/zentoo/SELLERS/DOLPHIN/JUNIO/23:06:2006/LE206126005632026060014040001EXP2.csv',
  ],
};

const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
const money = (v) => round2(v).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sum = (rows, sel) => round2(rows.reduce((t, r) => t + Number(sel(r) || 0), 0));
const monthOf = (v) => { const m = String(v || '').match(/^(\d{4})-(\d{2})/); return m ? `${m[1]}-${m[2]}` : null; };
const num6 = (v) => String(v || '').trim().replace(/\D/g, '').padStart(6, '0');

function parseCsvLine(line) {
  const cells = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i += 1; } else q = !q; }
    else if (ch === ',' && !q) { cells.push(cur); cur = ''; } else cur += ch;
  }
  cells.push(cur); return cells;
}
function readCsv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').trim();
  const lines = text.split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const v = parseCsvLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, v[i] || '']));
  });
}
const csvEscape = (v) => { const t = String(v ?? ''); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
function writeCsv(file, rows, columns) {
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvEscape(row[c])).join(','));
  fs.writeFileSync(path.join(OUT_DIR, file), `${lines.join('\n')}\n`);
}

// Build map numero -> {period: {total, fecha}} for boletas (tipo 03) across all SUNAT csvs
function loadSunatBoletas() {
  const byNumero = new Map();
  for (const [period, files] of Object.entries(CSVS)) {
    for (const f of files) {
      if (!fs.existsSync(f)) continue;
      for (const r of readCsv(f)) {
        if (String(r['Tipo CP/Doc.'] || '').padStart(2, '0') !== '03') continue;
        const numero = `${r['Serie del CDP']}-${num6(r['Nro CP o Doc. Nro Inicial (Rango)'])}`;
        const entry = byNumero.get(numero) || {};
        entry[period] = { total: round2(r['Total CP']), fecha: r['Fecha de emisión'] };
        byNumero.set(numero, entry);
      }
    }
  }
  return byNumero;
}

async function main() {
  if (!process.env.DATABASE_URL_POSTGRES) throw new Error('Missing DATABASE_URL_POSTGRES');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const sunat = loadSunatBoletas();

  const client = new Client({ connectionString: process.env.DATABASE_URL_POSTGRES });
  await client.connect();
  const res = await client.query(
    `select b.numero_completo, b.serie, b.fecha_emision, b.estado_sunat,
            b.mto_imp_venta::numeric as total, b.order_number, ds.fecha_resumen
     from boletas b
     left join daily_summaries ds on ds.id = b.daily_summary_id
     where b.company_id = $1
       and ((b.fecha_emision >= '2026-05-01' and b.fecha_emision < '2026-06-01')
            or (ds.fecha_resumen >= '2026-05-01' and ds.fecha_resumen < '2026-06-01'))
     order by b.serie, b.correlativo`, [COMPANY_ID]);
  await client.end();

  const boletas = res.rows.map((r) => {
    const emision = (r.fecha_emision || '').slice(0, 10);
    const resumen = r.fecha_resumen ? String(r.fecha_resumen).slice(0, 10) : '';
    const sunatEntry = sunat.get(r.numero_completo) || {};
    const sunatPeriods = Object.keys(sunatEntry); // ABRIL/MAYO/JUNIO
    let procedencia;
    if (sunatPeriods.includes('MAYO')) procedencia = 'MAYO (cuenta para mayo)';
    else if (sunatPeriods.includes('ABRIL')) procedencia = 'ABRIL';
    else if (sunatPeriods.includes('JUNIO')) procedencia = 'JUNIO';
    else procedencia = 'NO esta en SUNAT (pendiente)';
    return {
      numero: r.numero_completo, serie: r.serie, total: round2(r.total), estado: r.estado_sunat,
      emision, resumen, order: r.order_number || '',
      fiscal: monthOf(resumen || emision),
      sunat: sunatPeriods.join('+') || '-',
      procedencia,
    };
  });

  // Group by procedencia
  const groups = new Map();
  const order = ['MAYO (cuenta para mayo)', 'ABRIL', 'JUNIO', 'NO esta en SUNAT (pendiente)'];
  for (const o of order) groups.set(o, { proc: o, count: 0, total: 0, rows: [] });
  for (const b of boletas) {
    const g = groups.get(b.procedencia);
    g.count += 1; g.total = round2(g.total + b.total); g.rows.push(b);
  }

  // SUNAT MAYO boletas not in system
  const dbSet = new Set(boletas.map((b) => b.numero));
  const sunatMayoNotInDb = [];
  for (const [numero, entry] of sunat.entries()) {
    if (entry.MAYO && !dbSet.has(numero)) sunatMayoNotInDb.push({ numero, total: entry.MAYO.total, fecha: entry.MAYO.fecha });
  }

  writeCsv('procedencia_boletas_mayo.csv', boletas,
    ['numero', 'serie', 'total', 'estado', 'emision', 'resumen', 'fiscal', 'sunat', 'procedencia', 'order']);

  const pendientes = groups.get('NO esta en SUNAT (pendiente)').rows;

  const lines = [
    '# DOLPHIN — de donde viene cada boleta del sistema en mayo',
    '',
    `Generado: ${new Date().toISOString()}`,
    `RUC: ${RUC}`,
    '',
    'Tomo cada boleta que el sistema asocia a mayo (emision en mayo **o** resumen diario en mayo) y la',
    'busco en los reportes oficiales de SUNAT de **abril (202604)**, **mayo (202605)** y **junio (202606)**.',
    'Asi se ve a que periodo la asigno realmente SUNAT.',
    '',
    '## Resumen: procedencia de las boletas del sistema',
    '',
    '| De donde viene | Boletas | Total | Que significa |',
    '| --- | ---: | ---: | --- |',
    `| ✅ MAYO | ${groups.get('MAYO (cuenta para mayo)').count} | S/ ${money(groups.get('MAYO (cuenta para mayo)').total)} | SUNAT la lista en mayo: cuenta para mayo |`,
    `| ➡️ ABRIL | ${groups.get('ABRIL').count} | S/ ${money(groups.get('ABRIL').total)} | Emitida en abril; SUNAT la declaro en abril aunque el resumen salio en mayo |`,
    `| ➡️ JUNIO | ${groups.get('JUNIO').count} | S/ ${money(groups.get('JUNIO').total)} | Resumen en junio; SUNAT la cuenta en junio |`,
    `| ⚠️ NO esta en SUNAT | ${groups.get('NO esta en SUNAT (pendiente)').count} | S/ ${money(groups.get('NO esta en SUNAT (pendiente)').total)} | No aparece en ningun reporte SUNAT: pendiente de aceptar/declarar |`,
    `| **Total en sistema** | **${boletas.length}** | **S/ ${money(sum(boletas, (b) => b.total))}** | |`,
    '',
    `> Solo las **${groups.get('MAYO (cuenta para mayo)').count}** marcadas MAYO deberian compararse contra el reporte mensual de mayo de SUNAT.`,
    '',
    '## ⚠️ Boletas del sistema que NO estan en ningun reporte SUNAT (revisar)',
    '',
    pendientes.length ? '| Boleta | Total | Estado | Emision | Resumen | Orden |' : '_No hay; todas las boletas estan en algun reporte SUNAT._',
    ...(pendientes.length ? ['| --- | ---: | --- | --- | --- | --- |',
      ...pendientes.map((b) => `| ${b.numero} | S/ ${money(b.total)} | ${b.estado} | ${b.emision} | ${b.resumen || '-'} | ${b.order} |`)] : []),
    '',
    '## 🔴 Boletas que SUNAT lista en mayo pero NO estan en el sistema',
    '',
    sunatMayoNotInDb.length ? '| Boleta | Total SUNAT | Fecha |' : '_Ninguna; todas las de mayo de SUNAT estan en el sistema._',
    ...(sunatMayoNotInDb.length ? ['| --- | ---: | --- |',
      ...sunatMayoNotInDb.sort((a, b) => a.numero.localeCompare(b.numero)).map((b) => `| ${b.numero} | S/ ${money(b.total)} | ${b.fecha} |`)] : []),
    '',
    '## Detalle ABRIL (emitidas en abril, resumidas en mayo)',
    '',
    '| Boleta | Total | Estado | Emision | Resumen |',
    '| --- | ---: | --- | --- | --- |',
    ...groups.get('ABRIL').rows.map((b) => `| ${b.numero} | S/ ${money(b.total)} | ${b.estado} | ${b.emision} | ${b.resumen || '-'} |`),
    '',
    '## Detalle JUNIO (resumen en junio)',
    '',
    '| Boleta | Total | Estado | Emision | Resumen |',
    '| --- | ---: | --- | --- | --- |',
    ...groups.get('JUNIO').rows.map((b) => `| ${b.numero} | S/ ${money(b.total)} | ${b.estado} | ${b.emision} | ${b.resumen || '-'} |`),
    '',
    'Detalle completo boleta por boleta (con columna `sunat` = periodos donde aparece): `procedencia_boletas_mayo.csv`',
  ];
  const md = `${lines.join('\n')}\n`;
  fs.writeFileSync(path.join(OUT_DIR, 'procedencia_boletas_mayo.md'), md);
  console.log(md);
}

main().catch((e) => { console.error(e); process.exit(1); });
