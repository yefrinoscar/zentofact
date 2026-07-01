require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const RUC = '20612600563';
const COMPANY_ID = 2;
const PERIOD = '202605';
const MONTH = '2026-05';
const CSV_FILE = process.env.DOLPHIN_CSV
  || '/private/tmp/claude-501/-Users-ylaurach-Documents-repos-p-boletas-sunat/663d2872-311e-4885-a7f7-94aa1b9b17c7/scratchpad/dolphin/LE206126005632026060014040001EXP2.csv';
const OUT_DIR = path.resolve('reports/dolphin-mayo-2026');

const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
const abs2 = (v) => round2(Math.abs(Number(v || 0)));
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

const monthOf = (value) => {
  const m = String(value || '').match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
};
const num6 = (v) => String(v || '').trim().replace(/\D/g, '').padStart(6, '0');

async function main() {
  if (!process.env.DATABASE_URL_POSTGRES) throw new Error('Missing DATABASE_URL_POSTGRES');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const raw = readCsv(CSV_FILE);
  const tipoOf = (r) => String(r['Tipo CP/Doc.'] || '').padStart(2, '0');
  const numeroOf = (r) => `${r['Serie del CDP']}-${num6(r['Nro CP o Doc. Nro Inicial (Rango)'])}`;

  const csvBoletas = raw.filter((r) => tipoOf(r) === '03').map((r) => ({
    numero: numeroOf(r), serie: String(r['Serie del CDP'] || '').trim(),
    total: round2(r['Total CP']), fecha: r['Fecha de emisión'], estComp: String(r['Est. Comp'] || '').trim(),
  }));
  const csvNotes = raw.filter((r) => tipoOf(r) === '07').map((r) => ({
    numero: numeroOf(r), serie: String(r['Serie del CDP'] || '').trim(),
    total: abs2(r['Total CP']), fecha: r['Fecha de emisión'],
    afecta: `${r['Serie CP Modificado']}-${num6(r['Nro CP Modificado'])}`,
  }));
  const csvFacturas = raw.filter((r) => tipoOf(r) === '01');

  const csvBolMap = new Map(csvBoletas.map((r) => [r.numero, r]));
  const csvNoteMap = new Map(csvNotes.map((r) => [r.numero, r]));

  const client = new Client({ connectionString: process.env.DATABASE_URL_POSTGRES });
  await client.connect();
  const bRes = await client.query(
    `select b.numero_completo, b.serie, b.fecha_emision, b.estado_sunat,
            b.mto_imp_venta::numeric as total, b.order_number, ds.fecha_resumen
     from boletas b
     left join daily_summaries ds on ds.id = b.daily_summary_id
     where b.company_id = $1
       and ((b.fecha_emision >= '2026-05-01' and b.fecha_emision < '2026-06-01')
            or (ds.fecha_resumen >= '2026-05-01' and ds.fecha_resumen < '2026-06-01'))
     order by b.serie, b.correlativo`, [COMPANY_ID]);
  const nRes = await client.query(
    `select numero_completo, serie, fecha_emision, estado_sunat,
            mto_imp_venta::numeric as total, num_doc_afectado
     from credit_notes where company_id = $1
       and fecha_emision >= '2026-05-01' and fecha_emision < '2026-06-01'
     order by serie, correlativo`, [COMPANY_ID]);
  await client.end();

  const dbBoletas = bRes.rows.map((r) => ({
    numero: r.numero_completo, serie: r.serie, total: round2(r.total), estado: r.estado_sunat,
    fecha: (r.fecha_emision || '').slice(0, 10), resumen: r.fecha_resumen ? String(r.fecha_resumen).slice(0, 10) : '',
    order: r.order_number || '',
    fiscal: monthOf(r.fecha_resumen ? String(r.fecha_resumen).slice(0, 10) : (r.fecha_emision || '').slice(0, 10)),
    emision: monthOf((r.fecha_emision || '').slice(0, 10)),
  }));
  const dbNotes = nRes.rows.map((r) => ({
    numero: r.numero_completo, serie: r.serie, total: abs2(r.total), estado: r.estado_sunat,
    fecha: (r.fecha_emision || '').slice(0, 10), afecta: r.num_doc_afectado,
  }));
  const dbBolMap = new Map(dbBoletas.map((r) => [r.numero, r]));
  const dbNoteMap = new Map(dbNotes.map((r) => [r.numero, r]));

  // ---- Boletas cross ----
  const bExact = []; const bMismatch = []; const bDbNotCsv = [];
  for (const r of dbBoletas) {
    const m = csvBolMap.get(r.numero);
    if (!m) { bDbNotCsv.push(r); continue; }
    if (round2(r.total - m.total) !== 0) bMismatch.push({ ...r, csvTotal: m.total, dif: round2(r.total - m.total) });
    else bExact.push(r);
  }
  const bCsvNotDb = csvBoletas.filter((r) => !dbBolMap.has(r.numero));
  const reason = (r) => {
    if (r.fiscal === '2026-06') return 'Periodo JUNIO (resumen en junio)';
    if (r.fiscal && r.fiscal !== MONTH) return `Periodo fiscal ${r.fiscal}`;
    if (r.emision && r.emision !== MONTH) return `Emision ${r.emision}, resumida en mayo`;
    return 'Falta en CSV de mayo (revisar)';
  };
  for (const r of bDbNotCsv) r.motivo = reason(r);
  const bReasonGroups = new Map();
  for (const r of bDbNotCsv) {
    const g = bReasonGroups.get(r.motivo) || { motivo: r.motivo, count: 0, total: 0 };
    g.count += 1; g.total = round2(g.total + r.total); bReasonGroups.set(r.motivo, g);
  }

  // ---- Credit notes cross ----
  const nExact = []; const nMismatch = []; const nDbNotCsv = [];
  for (const r of dbNotes) {
    const m = csvNoteMap.get(r.numero);
    if (!m) { nDbNotCsv.push(r); continue; }
    if (round2(r.total - m.total) !== 0) nMismatch.push({ ...r, csvTotal: m.total, dif: round2(r.total - m.total) });
    else nExact.push(r);
  }
  const nCsvNotDb = csvNotes.filter((r) => !dbNoteMap.has(r.numero));

  // ---- Detail CSVs ----
  writeCsv('boletas_detalle.csv', [
    ...bExact.map((r) => ({ grupo: 'COINCIDE', tipo: '03', numero: r.numero, total_sistema: r.total, total_sunat: r.total, diferencia: 0, estado_sistema: r.estado, emision: r.fecha, resumen: r.resumen, motivo: '', order: r.order })),
    ...bMismatch.map((r) => ({ grupo: 'MONTO DISTINTO', tipo: '03', numero: r.numero, total_sistema: r.total, total_sunat: r.csvTotal, diferencia: r.dif, estado_sistema: r.estado, emision: r.fecha, resumen: r.resumen, motivo: '', order: r.order })),
    ...bDbNotCsv.map((r) => ({ grupo: 'EN SISTEMA, NO EN CSV', tipo: '03', numero: r.numero, total_sistema: r.total, total_sunat: '', diferencia: r.total, estado_sistema: r.estado, emision: r.fecha, resumen: r.resumen, motivo: r.motivo, order: r.order })),
    ...bCsvNotDb.map((r) => ({ grupo: 'EN CSV, NO EN SISTEMA', tipo: '03', numero: r.numero, total_sistema: '', total_sunat: r.total, diferencia: r.total, estado_sistema: '', emision: r.fecha, resumen: '', motivo: `Serie ${r.serie}`, order: '' })),
  ], ['grupo', 'tipo', 'numero', 'total_sistema', 'total_sunat', 'diferencia', 'estado_sistema', 'emision', 'resumen', 'motivo', 'order']);

  writeCsv('notas_credito_detalle.csv', [
    ...nExact.map((r) => ({ grupo: 'COINCIDE', numero: r.numero, total_sistema: r.total, total_sunat: r.total, diferencia: 0, afecta: r.afecta, emision: r.fecha })),
    ...nMismatch.map((r) => ({ grupo: 'MONTO DISTINTO', numero: r.numero, total_sistema: r.total, total_sunat: r.csvTotal, diferencia: r.dif, afecta: r.afecta, emision: r.fecha })),
    ...nDbNotCsv.map((r) => ({ grupo: 'EN SISTEMA, NO EN CSV', numero: r.numero, total_sistema: r.total, total_sunat: '', diferencia: r.total, afecta: r.afecta, emision: r.fecha })),
    ...nCsvNotDb.map((r) => ({ grupo: 'EN CSV, NO EN SISTEMA', numero: r.numero, total_sistema: '', total_sunat: r.total, diferencia: r.total, afecta: r.afecta, emision: r.fecha })),
  ], ['grupo', 'numero', 'total_sistema', 'total_sunat', 'diferencia', 'afecta', 'emision']);

  const estados = {};
  for (const r of dbBoletas) { estados[r.estado] = estados[r.estado] || { c: 0, t: 0 }; estados[r.estado].c += 1; estados[r.estado].t = round2(estados[r.estado].t + r.total); }

  const lines = [
    '# Comparacion DOLPHIN mayo 2026 (CSV SUNAT vs sistema)',
    '',
    `Generado: ${new Date().toISOString()}`,
    `RUC: ${RUC} | Periodo: ${PERIOD}`,
    `CSV: \`${CSV_FILE}\``,
    '',
    '## Resumen del CSV SUNAT',
    '',
    `- Boletas (03): ${csvBoletas.length} | S/ ${money(sum(csvBoletas, (r) => r.total))}`,
    `- Notas de credito (07): ${csvNotes.length} | S/ ${money(sum(csvNotes, (r) => r.total))}`,
    `- Facturas (01): ${csvFacturas.length}`,
    '',
    '## BOLETAS',
    '',
    '| Fuente | Boletas | Total |',
    '| --- | ---: | ---: |',
    `| CSV SUNAT (03) | ${csvBoletas.length} | S/ ${money(sum(csvBoletas, (r) => r.total))} |`,
    `| Sistema (fiscal mayo) | ${dbBoletas.length} | S/ ${money(sum(dbBoletas, (r) => r.total))} |`,
    '',
    '| Grupo | Boletas | Total |',
    '| --- | ---: | ---: |',
    `| Coinciden exacto | ${bExact.length} | S/ ${money(sum(bExact, (r) => r.total))} |`,
    `| Monto distinto | ${bMismatch.length} | S/ ${money(sum(bMismatch, (r) => r.dif))} |`,
    `| En sistema, NO en CSV | ${bDbNotCsv.length} | S/ ${money(sum(bDbNotCsv, (r) => r.total))} |`,
    `| En CSV, NO en sistema | ${bCsvNotDb.length} | S/ ${money(sum(bCsvNotDb, (r) => r.total))} |`,
    '',
    '### Boletas en sistema pero no en CSV de mayo — por motivo',
    '',
    '| Motivo | Boletas | Total |',
    '| --- | ---: | ---: |',
    ...Array.from(bReasonGroups.values()).map((g) => `| ${g.motivo} | ${g.count} | S/ ${money(g.total)} |`),
    '',
    '### Estado de las boletas del sistema (fiscal mayo)',
    '',
    '| Estado | Boletas | Total |',
    '| --- | ---: | ---: |',
    ...Object.entries(estados).map(([k, v]) => `| ${k} | ${v.c} | S/ ${money(v.t)} |`),
    '',
    '### Detalle: boletas con monto distinto',
    '',
    bMismatch.length ? '| Boleta | Sistema | SUNAT | Dif | Estado |' : '_Sin diferencias de monto._',
    ...(bMismatch.length ? ['| --- | ---: | ---: | ---: | --- |', ...bMismatch.map((r) => `| ${r.numero} | S/ ${money(r.total)} | S/ ${money(r.csvTotal)} | S/ ${money(r.dif)} | ${r.estado} |`)] : []),
    '',
    '### Detalle: boletas en CSV SUNAT pero NO en sistema',
    '',
    bCsvNotDb.length ? '| Boleta | Total SUNAT | Fecha | Est.Comp |' : '_Todas las boletas del CSV estan en el sistema._',
    ...(bCsvNotDb.length ? ['| --- | ---: | --- | --- |', ...bCsvNotDb.map((r) => `| ${r.numero} | S/ ${money(r.total)} | ${r.fecha} | ${r.estComp} |`)] : []),
    '',
    '### Detalle: boletas en sistema pero NO en CSV de mayo',
    '',
    bDbNotCsv.length ? '| Boleta | Total | Estado | Emision | Resumen | Motivo | Orden |' : '_Todas las boletas del sistema estan en el CSV._',
    ...(bDbNotCsv.length ? ['| --- | ---: | --- | --- | --- | --- | --- |', ...bDbNotCsv.map((r) => `| ${r.numero} | S/ ${money(r.total)} | ${r.estado} | ${r.fecha} | ${r.resumen || '-'} | ${r.motivo} | ${r.order} |`)] : []),
    '',
    '## NOTAS DE CREDITO',
    '',
    '| Fuente | Notas | Total |',
    '| --- | ---: | ---: |',
    `| CSV SUNAT (07) | ${csvNotes.length} | S/ ${money(sum(csvNotes, (r) => r.total))} |`,
    `| Sistema (emision mayo) | ${dbNotes.length} | S/ ${money(sum(dbNotes, (r) => r.total))} |`,
    '',
    '| Grupo | Notas | Total |',
    '| --- | ---: | ---: |',
    `| Coinciden exacto | ${nExact.length} | S/ ${money(sum(nExact, (r) => r.total))} |`,
    `| Monto distinto | ${nMismatch.length} | S/ ${money(sum(nMismatch, (r) => r.dif))} |`,
    `| En sistema, NO en CSV | ${nDbNotCsv.length} | S/ ${money(sum(nDbNotCsv, (r) => r.total))} |`,
    `| En CSV, NO en sistema | ${nCsvNotDb.length} | S/ ${money(sum(nCsvNotDb, (r) => r.total))} |`,
    '',
    '### Detalle: notas en CSV SUNAT pero NO en sistema',
    '',
    nCsvNotDb.length ? '| Nota | Total | Fecha | Afecta |' : '_Todas las notas del CSV estan en el sistema._',
    ...(nCsvNotDb.length ? ['| --- | ---: | --- | --- |', ...nCsvNotDb.map((r) => `| ${r.numero} | S/ ${money(r.total)} | ${r.fecha} | ${r.afecta} |`)] : []),
    '',
    '### Detalle: notas en sistema pero NO en CSV de mayo',
    '',
    nDbNotCsv.length ? '| Nota | Total | Estado | Emision | Afecta |' : '_Todas las notas del sistema estan en el CSV._',
    ...(nDbNotCsv.length ? ['| --- | ---: | --- | --- | --- |', ...nDbNotCsv.map((r) => `| ${r.numero} | S/ ${money(r.total)} | ${r.estado} | ${r.fecha} | ${r.afecta} |`)] : []),
    '',
    'Detalle fila por fila: `boletas_detalle.csv`, `notas_credito_detalle.csv`',
  ];
  const md = `${lines.join('\n')}\n`;
  fs.writeFileSync(path.join(OUT_DIR, 'comparacion_dolphin_mayo.md'), md);
  console.log(md);
}

main().catch((e) => { console.error(e); process.exit(1); });
