require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const RUC = '20612400882';
const COMPANY_ID = 4;
const PERIOD = '202605';
const CSV_FILE = '/Users/ylaurach/Library/CloudStorage/OneDrive2-Personal/zentoo/SELLERS/RUNAPUMA/MAYO/LE206124008822026060014040001EXP2.csv';
const OUT_DIR = path.resolve('reports/runapuma-mayo-2026');

const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
const money = (v) => round2(v).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sum = (rows, sel) => round2(rows.reduce((t, r) => t + Number(sel(r) || 0), 0));

function parseCsvLine(line) {
  const cells = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i += 1; } else q = !q;
    } else if (ch === ',' && !q) { cells.push(cur); cur = ''; } else cur += ch;
  }
  cells.push(cur);
  return cells;
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

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(file, rows, columns) {
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvEscape(row[c])).join(','));
  fs.writeFileSync(path.join(OUT_DIR, file), `${lines.join('\n')}\n`);
}

function monthOf(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

async function main() {
  if (!process.env.DATABASE_URL_POSTGRES) throw new Error('Missing DATABASE_URL_POSTGRES');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // --- SUNAT CSV boletas (tipo 03) ---
  const sunat = readCsv(CSV_FILE)
    .filter((r) => String(r['Tipo CP/Doc.'] || '').padStart(2, '0') === '03')
    .map((r) => ({
      numero: `${r['Serie del CDP']}-${String(r['Nro CP o Doc. Nro Inicial (Rango)'] || '').padStart(6, '0')}`,
      serie: String(r['Serie del CDP'] || '').trim(),
      total: round2(r['Total CP']),
      fecha: r['Fecha de emisión'],
      estComp: String(r['Est. Comp'] || '').trim(),
    }));
  const sunatMap = new Map(sunat.map((r) => [r.numero, r]));

  // --- System boletas: anything fiscally May or present in the CSV ---
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

  const db = res.rows.map((r) => ({
    numero: r.numero_completo,
    serie: r.serie,
    total: round2(r.total),
    estado: r.estado_sunat,
    fecha: (r.fecha_emision || '').slice(0, 10),
    resumen: r.fecha_resumen ? String(r.fecha_resumen).slice(0, 10) : '',
    order: r.order_number || '',
    // fiscal period = summary month if present, else emission month
    fiscal: monthOf(r.fecha_resumen ? String(r.fecha_resumen).slice(0, 10) : (r.fecha_emision || '').slice(0, 10)),
    emision: monthOf((r.fecha_emision || '').slice(0, 10)),
  }));
  const dbMap = new Map(db.map((r) => [r.numero, r]));

  // --- Compare ---
  const exact = [];
  const mismatch = [];
  const dbNotInSunat = [];
  for (const r of db) {
    const m = sunatMap.get(r.numero);
    if (!m) { dbNotInSunat.push(r); continue; }
    if (round2(r.total - m.total) !== 0) mismatch.push({ ...r, sunatTotal: m.total, dif: round2(r.total - m.total) });
    else exact.push(r);
  }
  const sunatNotInDb = sunat.filter((r) => !dbMap.has(r.numero));

  // classify dbNotInSunat by reason
  const reason = (r) => {
    if (r.fiscal === '2026-06') return 'Periodo JUNIO (resumen en junio)';
    if (r.emision && r.emision !== '2026-05' && r.fiscal === '2026-05') return `Emision ${r.emision}, resumida en mayo`;
    return 'Falta en CSV de mayo';
  };
  for (const r of dbNotInSunat) r.motivo = reason(r);

  const reasonGroups = new Map();
  for (const r of dbNotInSunat) {
    const g = reasonGroups.get(r.motivo) || { motivo: r.motivo, count: 0, total: 0 };
    g.count += 1; g.total = round2(g.total + r.total);
    reasonGroups.set(r.motivo, g);
  }

  // --- Detail CSV ---
  const detail = [
    ...exact.map((r) => ({ grupo: 'COINCIDE EXACTO', numero: r.numero, total_sistema: r.total, total_sunat: r.total, diferencia: 0, estado_sistema: r.estado, fecha_emision: r.fecha, fecha_resumen: r.resumen, order: r.order, motivo: '' })),
    ...mismatch.map((r) => ({ grupo: 'MONTO DISTINTO', numero: r.numero, total_sistema: r.total, total_sunat: r.sunatTotal, diferencia: r.dif, estado_sistema: r.estado, fecha_emision: r.fecha, fecha_resumen: r.resumen, order: r.order, motivo: '' })),
    ...dbNotInSunat.map((r) => ({ grupo: 'EN SISTEMA, NO EN CSV', numero: r.numero, total_sistema: r.total, total_sunat: '', diferencia: r.total, estado_sistema: r.estado, fecha_emision: r.fecha, fecha_resumen: r.resumen, order: r.order, motivo: r.motivo })),
    ...sunatNotInDb.map((r) => ({ grupo: 'EN CSV, NO EN SISTEMA', numero: r.numero, total_sistema: '', total_sunat: r.total, diferencia: r.total, estado_sistema: '', fecha_emision: r.fecha, fecha_resumen: '', order: '', motivo: `Serie ${r.serie} (contingencia)` })),
  ];
  writeCsv('comparacion_boletas_runapuma_mayo.csv', detail, ['grupo', 'numero', 'total_sistema', 'total_sunat', 'diferencia', 'estado_sistema', 'fecha_emision', 'fecha_resumen', 'order', 'motivo']);

  // estado breakdown in system
  const estados = {};
  for (const r of db) { estados[r.estado] = estados[r.estado] || { c: 0, t: 0 }; estados[r.estado].c += 1; estados[r.estado].t = round2(estados[r.estado].t + r.total); }

  const lines = [
    '# Comparacion de boletas RUNAPUMA mayo 2026 (CSV SUNAT vs sistema)',
    '',
    `Generado: ${new Date().toISOString()}`,
    `RUC: ${RUC} | Periodo: ${PERIOD}`,
    `CSV: \`${CSV_FILE}\``,
    '',
    '## Regla de comparacion',
    '',
    '- Solo boletas (tipo 03). Notas de credito y facturas se reportan aparte.',
    '- Se cruza por numero completo y se compara `mto_imp_venta` (sistema) vs `Total CP` (SUNAT).',
    '- Periodo fiscal del sistema = mes del resumen diario; si no tiene, mes de emision.',
    '',
    '## Totales',
    '',
    '| Fuente | Boletas | Total |',
    '| --- | ---: | ---: |',
    `| CSV SUNAT (tipo 03) | ${sunat.length} | S/ ${money(sum(sunat, (r) => r.total))} |`,
    `| Sistema (fiscal mayo + las del CSV) | ${db.length} | S/ ${money(sum(db, (r) => r.total))} |`,
    '',
    '## Resultado del cruce',
    '',
    '| Grupo | Boletas | Total |',
    '| --- | ---: | ---: |',
    `| Coinciden exacto (numero y monto) | ${exact.length} | S/ ${money(sum(exact, (r) => r.total))} |`,
    `| Monto distinto | ${mismatch.length} | S/ ${money(sum(mismatch, (r) => r.dif))} |`,
    `| En sistema, NO en CSV SUNAT | ${dbNotInSunat.length} | S/ ${money(sum(dbNotInSunat, (r) => r.total))} |`,
    `| En CSV SUNAT, NO en sistema | ${sunatNotInDb.length} | S/ ${money(sum(sunatNotInDb, (r) => r.total))} |`,
    '',
    '## Desglose: en sistema pero no en CSV de mayo',
    '',
    '| Motivo | Boletas | Total |',
    '| --- | ---: | ---: |',
    ...Array.from(reasonGroups.values()).map((g) => `| ${g.motivo} | ${g.count} | S/ ${money(g.total)} |`),
    '',
    '## Estado de las boletas en el sistema',
    '',
    '| Estado | Boletas | Total |',
    '| --- | ---: | ---: |',
    ...Object.entries(estados).map(([k, v]) => `| ${k} | ${v.c} | S/ ${money(v.t)} |`),
    '',
    '## Detalle: monto distinto',
    '',
    mismatch.length ? '| Boleta | Sistema | SUNAT | Diferencia | Estado | Orden |' : '_Sin diferencias de monto._',
    ...(mismatch.length ? ['| --- | ---: | ---: | ---: | --- | --- |',
      ...mismatch.map((r) => `| ${r.numero} | S/ ${money(r.total)} | S/ ${money(r.sunatTotal)} | S/ ${money(r.dif)} | ${r.estado} | ${r.order} |`)] : []),
    '',
    '## Detalle: en CSV SUNAT pero no en sistema',
    '',
    sunatNotInDb.length ? '| Boleta | Total SUNAT | Fecha | Est.Comp |' : '_Todas las boletas del CSV estan en el sistema._',
    ...(sunatNotInDb.length ? ['| --- | ---: | --- | --- |',
      ...sunatNotInDb.map((r) => `| ${r.numero} | S/ ${money(r.total)} | ${r.fecha} | ${r.estComp} |`)] : []),
    '',
    '## Detalle: en sistema pero no en CSV de mayo',
    '',
    '| Boleta | Total | Estado | Emision | Resumen | Motivo | Orden |',
    '| --- | ---: | --- | --- | --- | --- | --- |',
    ...dbNotInSunat.map((r) => `| ${r.numero} | S/ ${money(r.total)} | ${r.estado} | ${r.fecha} | ${r.resumen || '-'} | ${r.motivo} | ${r.order} |`),
    '',
    'Detalle completo fila por fila: `comparacion_boletas_runapuma_mayo.csv`',
  ];
  const md = `${lines.join('\n')}\n`;
  fs.writeFileSync(path.join(OUT_DIR, 'comparacion_boletas_runapuma_mayo.md'), md);
  console.log(md);
}

main().catch((e) => { console.error(e); process.exit(1); });
