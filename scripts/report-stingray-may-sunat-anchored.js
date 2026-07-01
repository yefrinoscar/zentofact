require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const RUC = '20612595675';
const COMPANY_ID = 6;
const CSV = '/Users/ylaurach/Library/CloudStorage/OneDrive2-Personal/zentoo/SELLERS/STINGRAY/MAYO/LE206125956752026060014040001EXP2.csv';
const OUT_DIR = path.resolve('reports/stingray-2026');

const r2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
const a2 = (v) => r2(Math.abs(Number(v || 0)));
const money = (v) => r2(v).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sum = (rows, sel) => r2(rows.reduce((t, r) => t + Number(sel(r) || 0), 0));
const n6 = (v) => String(v || '').trim().replace(/\D/g, '').padStart(6, '0');
function pl(l) { const c = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (ch === ',' && !q) { c.push(cur); cur = ''; } else cur += ch; } c.push(cur); return c; }
function rc(f) { const t = fs.readFileSync(f, 'utf8').replace(/^﻿/, '').trim(); const ls = t.split(/\r?\n/); const h = pl(ls[0]); return ls.slice(1).filter(Boolean).map((l) => { const v = pl(l); return Object.fromEntries(h.map((hh, i) => [hh, v[i] || ''])); }); }
const tipo = (r) => String(r['Tipo CP/Doc.'] || '').padStart(2, '0');
const numero = (r) => `${r['Serie del CDP']}-${n6(r['Nro CP o Doc. Nro Inicial (Rango)'])}`;

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const rows = rc(CSV);
  const sBol = rows.filter((r) => tipo(r) === '03').map((r) => ({ numero: numero(r), serie: String(r['Serie del CDP']).trim(), total: r2(r['Total CP']), fecha: r['Fecha de emisión'] }));
  const sNc = rows.filter((r) => tipo(r) === '07').map((r) => ({ numero: numero(r), total: a2(r['Total CP']), fecha: r['Fecha de emisión'], afecta: `${r['Serie CP Modificado']}-${n6(r['Nro CP Modificado'])}` }));

  const client = new Client({ connectionString: process.env.DATABASE_URL_POSTGRES });
  await client.connect();
  // todo el sistema por numero (sin filtrar por fecha) para company 6
  const dbBol = new Map((await client.query(`select numero_completo, mto_imp_venta::numeric total, estado_sunat, fecha_emision from boletas where company_id=$1`, [COMPANY_ID])).rows.map((r) => [r.numero_completo, { total: r2(r.total), estado: r.estado_sunat, fecha: (r.fecha_emision || '').slice(0, 10) }]));
  const dbNc = new Map((await client.query(`select numero_completo, mto_imp_venta::numeric total, estado_sunat, affected_boleta_id from credit_notes where company_id=$1`, [COMPANY_ID])).rows.map((r) => [r.numero_completo, { total: a2(r.total), estado: r.estado_sunat, linked: Boolean(r.affected_boleta_id) }]));
  await client.end();

  // Boletas: cobertura del CSV SUNAT mayo en el sistema (por numero)
  const bIn = [], bMisAmount = [], bMissing = [];
  for (const r of sBol) {
    const d = dbBol.get(r.numero);
    if (!d) bMissing.push(r);
    else if (r2(d.total - r.total) !== 0) bMisAmount.push({ ...r, dbTotal: d.total, dbFecha: d.fecha });
    else bIn.push({ ...r, dbFecha: d.fecha });
  }
  const bInOtherMonth = bIn.filter((r) => r.dbFecha.slice(0, 7) !== '2026-05');
  const missByserie = {};
  for (const r of bMissing) { const s = r.serie; missByserie[s] = missByserie[s] || { n: 0, t: 0 }; missByserie[s].n++; missByserie[s].t = r2(missByserie[s].t + r.total); }

  // NC: cobertura
  const nIn = [], nMissing = [];
  for (const r of sNc) { if (dbNc.has(r.numero)) nIn.push(r); else nMissing.push(r); }

  const lines = [
    '# STINGRAY mayo 2026 — reporte anclado a SUNAT',
    '',
    `Generado: ${new Date().toISOString()}`,
    `RUC: ${RUC} | Periodo: 202605`,
    '',
    'Regla: un comprobante pertenece a mayo si **SUNAT lo declara en mayo**. Se busca cada uno en el',
    'sistema **por numero** (sin importar la fecha que tenga el sistema), porque SUNAT asigna el periodo',
    'caso por caso y no siempre coincide con la fecha de emision interna.',
    '',
    '## Boletas que SUNAT declara en mayo',
    '',
    '| | Boletas | Total |',
    '| --- | ---: | ---: |',
    `| SUNAT mayo (03) | ${sBol.length} | S/ ${money(sum(sBol, (r) => r.total))} |`,
    `| Estan en el sistema (mismo monto) | ${bIn.length} | S/ ${money(sum(bIn, (r) => r.total))} |`,
    `| Estan pero con monto distinto | ${bMisAmount.length} | S/ ${money(sum(bMisAmount, (r) => r.total))} |`,
    `| Faltan en el sistema | ${bMissing.length} | S/ ${money(sum(bMissing, (r) => r.total))} |`,
    '',
    `> De las que estan en el sistema, **${bInOtherMonth.length}** tienen fecha de otro mes (abril) pero SUNAT las cuenta en mayo — coberturadas igual por numero.`,
    '',
    '### Faltantes por serie',
    '',
    '| Serie | Boletas | Total |',
    '| --- | ---: | ---: |',
    ...Object.entries(missByserie).map(([s, v]) => `| ${s} | ${v.n} | S/ ${money(v.t)} |`),
    '',
    ...(bMisAmount.length ? ['### Monto distinto', '', '| Boleta | SUNAT | Sistema |', '| --- | ---: | ---: |', ...bMisAmount.map((r) => `| ${r.numero} | S/ ${money(r.total)} | S/ ${money(r.dbTotal)} |`), ''] : []),
    '## Notas de credito que SUNAT declara en mayo',
    '',
    '| | Notas | Total |',
    '| --- | ---: | ---: |',
    `| SUNAT mayo (07) | ${sNc.length} | S/ ${money(sum(sNc, (r) => r.total))} |`,
    `| Estan en el sistema | ${nIn.length} | S/ ${money(sum(nIn, (r) => r.total))} |`,
    `| Faltan en el sistema | ${nMissing.length} | S/ ${money(sum(nMissing, (r) => r.total))} |`,
    '',
    ...(nMissing.length ? ['Faltantes:', '| Nota | Total | Afecta |', '| --- | ---: | --- |', ...nMissing.map((r) => `| ${r.numero} | S/ ${money(r.total)} | ${r.afecta} |`), ''] : ['_Todas las NC de mayo de SUNAT estan en el sistema._', '']),
    '## Resumen',
    '',
    `- Boletas: ${bIn.length + bMisAmount.length}/${sBol.length} cubiertas, faltan ${bMissing.length} (todas serie EB01, S/ ${money(sum(bMissing, (r) => r.total))}).`,
    `- Notas de credito: ${nIn.length}/${sNc.length} cubiertas, faltan ${nMissing.length}.`,
  ];
  const md = `${lines.join('\n')}\n`;
  fs.writeFileSync(path.join(OUT_DIR, 'reporte_stingray_mayo_sunat.md'), md);
  console.log(md);
}
main().catch((e) => { console.error(e); process.exit(1); });
