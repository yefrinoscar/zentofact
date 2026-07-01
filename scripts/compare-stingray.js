require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const RUC = '20612595675';
const COMPANY_ID = 6;
const OUT_DIR = path.resolve('reports/stingray-2026');

const CSVS = {
  ABRIL: '/Users/ylaurach/Library/CloudStorage/OneDrive2-Personal/zentoo/SELLERS/STINGRAY/ABRIL/LE206125956752026060014040001EXP2.csv',
  MAYO: '/Users/ylaurach/Library/CloudStorage/OneDrive2-Personal/zentoo/SELLERS/STINGRAY/MAYO/LE206125956752026060014040001EXP2.csv',
  JUNIO: '/Users/ylaurach/Library/CloudStorage/OneDrive2-Personal/zentoo/SELLERS/STINGRAY/JUNIO/23:06:2026/LE206125956752026060014040001EXP2.csv',
};
const MONTHS = { MAYO: '2026-05', JUNIO: '2026-06' };

const r2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
const a2 = (v) => r2(Math.abs(Number(v || 0)));
const money = (v) => r2(v).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sum = (rows, sel) => r2(rows.reduce((t, r) => t + Number(sel(r) || 0), 0));
const n6 = (v) => String(v || '').trim().replace(/\D/g, '').padStart(6, '0');

function pl(l) { const c = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (ch === ',' && !q) { c.push(cur); cur = ''; } else cur += ch; } c.push(cur); return c; }
function rc(f) { if (!fs.existsSync(f)) return []; const t = fs.readFileSync(f, 'utf8').replace(/^﻿/, '').trim(); const ls = t.split(/\r?\n/); const h = pl(ls[0]); return ls.slice(1).filter(Boolean).map((l) => { const v = pl(l); return Object.fromEntries(h.map((hh, i) => [hh, v[i] || ''])); }); }
const tipo = (r) => String(r['Tipo CP/Doc.'] || '').padStart(2, '0');
const numero = (r) => `${r['Serie del CDP']}-${n6(r['Nro CP o Doc. Nro Inicial (Rango)'])}`;

function csvBoletas(file) { return rc(file).filter((r) => tipo(r) === '03').map((r) => ({ numero: numero(r), serie: String(r['Serie del CDP']).trim(), total: r2(r['Total CP']), fecha: r['Fecha de emisión'] })); }
function csvNotes(file) { return rc(file).filter((r) => tipo(r) === '07').map((r) => ({ numero: numero(r), total: a2(r['Total CP']), fecha: r['Fecha de emisión'], afecta: `${r['Serie CP Modificado']}-${n6(r['Nro CP Modificado'])}` })); }

async function main() {
  if (!process.env.DATABASE_URL_POSTGRES) throw new Error('Missing DATABASE_URL_POSTGRES');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // boleta numero -> set of periods in SUNAT (for provenance of discrepancies)
  const sunatBoletaPeriods = new Map();
  for (const [period, file] of Object.entries(CSVS)) {
    for (const b of csvBoletas(file)) {
      const e = sunatBoletaPeriods.get(b.numero) || new Set();
      e.add(period); sunatBoletaPeriods.set(b.numero, e);
    }
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL_POSTGRES });
  await client.connect();
  const out = [];
  out.push('# STINGRAY — comparacion mayo y junio 2026 (CSV SUNAT vs sistema)', '', `Generado: ${new Date().toISOString()}`, `RUC: ${RUC}`, '');

  for (const monthName of ['MAYO', 'JUNIO']) {
    const ym = MONTHS[monthName];
    const sBol = csvBoletas(CSVS[monthName]);
    const sNc = csvNotes(CSVS[monthName]);
    const sBolMap = new Map(sBol.map((r) => [r.numero, r]));
    const sNcMap = new Map(sNc.map((r) => [r.numero, r]));

    const start = `${ym}-01`;
    const end = ym === '2026-05' ? '2026-06-01' : '2026-07-01';
    const dbBol = (await client.query(
      `select numero_completo, mto_imp_venta::numeric total, estado_sunat, fecha_emision
       from boletas where company_id=$1 and fecha_emision>=$2 and fecha_emision<$3`, [COMPANY_ID, start, end])).rows
      .map((r) => ({ numero: r.numero_completo, total: r2(r.total), estado: r.estado_sunat, fecha: (r.fecha_emision || '').slice(0, 10) }));
    const dbNc = (await client.query(
      `select numero_completo, mto_imp_venta::numeric total, estado_sunat, fecha_emision, num_doc_afectado
       from credit_notes where company_id=$1 and fecha_emision>=$2 and fecha_emision<$3`, [COMPANY_ID, start, end])).rows
      .map((r) => ({ numero: r.numero_completo, total: a2(r.total), estado: r.estado_sunat, fecha: (r.fecha_emision || '').slice(0, 10), afecta: r.num_doc_afectado }));
    const dbBolMap = new Map(dbBol.map((r) => [r.numero, r]));
    const dbNcMap = new Map(dbNc.map((r) => [r.numero, r]));

    // boletas cross
    const bEx = [], bMis = [], bDbNot = [];
    for (const r of dbBol) { const x = sBolMap.get(r.numero); if (!x) bDbNot.push(r); else if (r2(r.total - x.total) !== 0) bMis.push({ ...r, csv: x.total }); else bEx.push(r); }
    const bCsvNot = sBol.filter((r) => !dbBolMap.has(r.numero));
    // notes cross
    const nEx = [], nMis = [], nDbNot = [];
    for (const r of dbNc) { const x = sNcMap.get(r.numero); if (!x) nDbNot.push(r); else if (r2(r.total - x.total) !== 0) nMis.push({ ...r, csv: x.total }); else nEx.push(r); }
    const nCsvNot = sNc.filter((r) => !dbNcMap.has(r.numero));

    const prov = (numeroc) => { const set = sunatBoletaPeriods.get(numeroc); return set ? [...set].join('+') : '-'; };

    out.push(`## ${monthName} ${ym}`, '',
      '### Boletas', '',
      '| Fuente | Boletas | Total |', '| --- | ---: | ---: |',
      `| SUNAT (03) | ${sBol.length} | S/ ${money(sum(sBol, (r) => r.total))} |`,
      `| Sistema (emision ${monthName.toLowerCase()}) | ${dbBol.length} | S/ ${money(sum(dbBol, (r) => r.total))} |`,
      '',
      '| Cruce | Cantidad | Total |', '| --- | ---: | ---: |',
      `| Coinciden exacto | ${bEx.length} | S/ ${money(sum(bEx, (r) => r.total))} |`,
      `| Monto distinto | ${bMis.length} | S/ ${money(sum(bMis, (r) => r2(r.total - r.csv)))} |`,
      `| En sistema, NO en SUNAT | ${bDbNot.length} | S/ ${money(sum(bDbNot, (r) => r.total))} |`,
      `| En SUNAT, NO en sistema | ${bCsvNot.length} | S/ ${money(sum(bCsvNot, (r) => r.total))} |`,
      '');
    if (bMis.length) out.push('Monto distinto:', '| Boleta | Sistema | SUNAT |', '| --- | ---: | ---: |', ...bMis.map((r) => `| ${r.numero} | S/ ${money(r.total)} | S/ ${money(r.csv)} |`), '');
    if (bDbNot.length) out.push('En sistema pero NO en SUNAT (con periodos donde SUNAT si la tiene):', '| Boleta | Total | Estado | Emision | SUNAT la tiene en |', '| --- | ---: | --- | --- | --- |', ...bDbNot.map((r) => `| ${r.numero} | S/ ${money(r.total)} | ${r.estado} | ${r.fecha} | ${prov(r.numero)} |`), '');
    if (bCsvNot.length) out.push('En SUNAT pero NO en sistema:', '| Boleta | Total | Fecha |', '| --- | ---: | --- |', ...bCsvNot.map((r) => `| ${r.numero} | S/ ${money(r.total)} | ${r.fecha} |`), '');

    out.push('### Notas de credito', '',
      '| Fuente | Notas | Total |', '| --- | ---: | ---: |',
      `| SUNAT (07) | ${sNc.length} | S/ ${money(sum(sNc, (r) => r.total))} |`,
      `| Sistema (emision ${monthName.toLowerCase()}) | ${dbNc.length} | S/ ${money(sum(dbNc, (r) => r.total))} |`,
      '',
      '| Cruce | Cantidad | Total |', '| --- | ---: | ---: |',
      `| Coinciden exacto | ${nEx.length} | S/ ${money(sum(nEx, (r) => r.total))} |`,
      `| Monto distinto | ${nMis.length} | |`,
      `| En sistema, NO en SUNAT | ${nDbNot.length} | S/ ${money(sum(nDbNot, (r) => r.total))} |`,
      `| En SUNAT, NO en sistema | ${nCsvNot.length} | S/ ${money(sum(nCsvNot, (r) => r.total))} |`,
      '');
    if (nCsvNot.length) out.push('NC en SUNAT pero NO en sistema:', '| Nota | Total | Fecha | Afecta |', '| --- | ---: | --- | --- |', ...nCsvNot.map((r) => `| ${r.numero} | S/ ${money(r.total)} | ${r.fecha} | ${r.afecta} |`), '');
    if (nDbNot.length) out.push('NC en sistema pero NO en SUNAT:', '| Nota | Total | Estado | Emision | Afecta |', '| --- | ---: | --- | --- | --- |', ...nDbNot.map((r) => `| ${r.numero} | S/ ${money(r.total)} | ${r.estado} | ${r.fecha} | ${r.afecta} |`), '');
    out.push('');
  }
  await client.end();

  const md = `${out.join('\n')}\n`;
  fs.writeFileSync(path.join(OUT_DIR, 'comparacion_stingray_mayo_junio.md'), md);
  console.log(md);
}
main().catch((e) => { console.error(e); process.exit(1); });
