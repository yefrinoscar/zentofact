const fs = require('fs');
const path = require('path');

const input = path.resolve('reports/sunat-mayo-2026-limbo-higher/auditoria_41_boletas_extra.csv');
const outDir = path.resolve('reports/sunat-mayo-2026-limbo-higher');
const outCsv = path.join(outDir, 'faltantes_mayo_aparecen_junio.csv');
const outMd = path.join(outDir, 'faltantes_mayo_aparecen_junio.md');

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function readCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
  });
}

function writeCsv(file, rows) {
  const headers = [
    'comprobante',
    'fecha_db_mayo',
    'fecha_sunat_junio',
    'periodo_sunat',
    'total',
    'estado_db',
    'orden_falabella',
    'seller_api',
    'seller_origen',
    'resumen',
    'fecha_resumen',
    'estado_resumen',
    'nota_credito',
    'fecha_nota',
    'creada_falabella',
    'actualizada_falabella',
    'estado_falabella',
  ];
  const escape = (value) => {
    const str = String(value ?? '');
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escape(row[header])).join(','));
  }
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

function money(value) {
  return Number(value || 0);
}

function total(rows) {
  return rows.reduce((sum, row) => sum + money(row.total), 0);
}

function fmt(value) {
  return Number(value).toFixed(2);
}

function sunatJuneDate(summary) {
  if (summary === 'RC-20260609-1') return '2026-06-09';
  if (summary === 'RC-20260613-9') return '2026-06-12';
  return '';
}

function status(row) {
  if (row.summary === 'RC-20260609-1' || row.summary === 'RC-20260613-9') {
    return 'Aparece en CSV SUNAT junio';
  }
  return 'No aparece en CSV abril/mayo/junio; SUNAT individual valida informada';
}

const sourceRows = readCsv(input);
const normalized = sourceRows.map((row) => ({
  comprobante: row.numeroCompleto,
  fecha_db_mayo: row.fechaEmisionDb,
  fecha_sunat_junio: sunatJuneDate(row.summary),
  periodo_sunat: sunatJuneDate(row.summary) ? '202606' : '',
  total: row.totalDb,
  estado_db: row.estadoDb,
  orden_falabella: row.orderNumber,
  seller_api: row.falabellaSeller,
  seller_origen: row.falabellaSellerCompany,
  resumen: row.summary,
  fecha_resumen: row.summaryDate,
  estado_resumen: row.summaryState,
  nota_credito: row.notaCredito,
  fecha_nota: row.notaFecha,
  creada_falabella: row.falabellaCreatedAt,
  actualizada_falabella: row.falabellaUpdatedAt,
  estado_falabella: row.falabellaStatus,
  estado_cruce: status(row),
}));

const inJune = normalized.filter((row) => row.periodo_sunat === '202606');
const notInMassiveCsv = normalized.filter((row) => !row.periodo_sunat);
writeCsv(outCsv, inJune);

const bySummary = new Map();
for (const row of inJune) {
  const current = bySummary.get(row.resumen) || [];
  current.push(row);
  bySummary.set(row.resumen, current);
}

const bySeller = new Map();
for (const row of inJune) {
  const key = `${row.seller_api} / ${row.seller_origen}`;
  const current = bySeller.get(key) || [];
  current.push(row);
  bySeller.set(key, current);
}

const noteRows = inJune.filter((row) => row.nota_credito);
const lines = [
  '# Boletas faltantes en mayo que aparecen en junio',
  '',
  'Base: auditoria de 41 boletas extra de mayo para RUC 20607809136.',
  '',
  '## Resumen',
  '',
  `- Faltaban en CSV SUNAT mayo y aparecen en CSV SUNAT junio: ${inJune.length} boletas, S/ ${fmt(total(inJune))}.`,
  `- Faltaban en CSV SUNAT mayo y no aparecen en CSV masivo abril/mayo/junio revisado: ${notInMassiveCsv.length} boletas, S/ ${fmt(total(notInMassiveCsv))}.`,
  `- Total de la auditoria original: ${normalized.length} boletas, S/ ${fmt(total(normalized))}.`,
  '',
  '## Por resumen SUNAT',
  '',
  '| Resumen | Fecha resumen | Fecha en CSV junio | Cantidad | Total |',
  '| --- | --- | --- | ---: | ---: |',
  ...[...bySummary.entries()].map(([summary, rows]) => `| ${summary} | ${rows[0].fecha_resumen} | ${rows[0].fecha_sunat_junio} | ${rows.length} | S/ ${fmt(total(rows))} |`),
  '',
  '## Por seller Falabella',
  '',
  '| Seller API | Cantidad | Total |',
  '| --- | ---: | ---: |',
  ...[...bySeller.entries()].map(([seller, rows]) => `| ${seller} | ${rows.length} | S/ ${fmt(total(rows))} |`),
  '',
  '## Detalle: faltaban en mayo y aparecen en junio',
  '',
  '| Boleta | Fecha DB mayo | Fecha CSV junio | Total | Orden | Seller | Resumen | NC |',
  '| --- | --- | --- | ---: | --- | --- | --- | --- |',
  ...inJune.map((row) => `| ${row.comprobante} | ${row.fecha_db_mayo} | ${row.fecha_sunat_junio} | S/ ${fmt(row.total)} | ${row.orden_falabella} | ${row.seller_api} | ${row.resumen} | ${row.nota_credito || '-'} |`),
  '',
  '## Notas de credito relacionadas',
  '',
  `- ${noteRows.length} de estas boletas tienen nota de credito registrada/referenciada en la auditoria.`,
  '',
  '| Boleta afectada | Nota de credito | Fecha nota | Total boleta | Seller |',
  '| --- | --- | --- | ---: | --- |',
  ...noteRows.map((row) => `| ${row.comprobante} | ${row.nota_credito} | ${row.fecha_nota || '-'} | S/ ${fmt(row.total)} | ${row.seller_api} |`),
  '',
  '## Aparte: informadas a SUNAT individual, pero fuera de CSV masivo revisado',
  '',
  '| Boleta | Fecha DB | Total | Orden | Resumen | Estado |',
  '| --- | --- | ---: | --- | --- | --- |',
  ...notInMassiveCsv.map((row) => `| ${row.comprobante} | ${row.fecha_db_mayo} | S/ ${fmt(row.total)} | ${row.orden_falabella} | ${row.resumen} | ${row.estado_cruce} |`),
  '',
  '## Archivos',
  '',
  `- CSV detalle: ${outCsv}`,
];

fs.writeFileSync(outMd, `${lines.join('\n')}\n`);
console.log(JSON.stringify({
  outMd,
  outCsv,
  inJune: { count: inJune.length, total: fmt(total(inJune)) },
  notInMassiveCsv: { count: notInMassiveCsv.length, total: fmt(total(notInMassiveCsv)) },
  noteRows: noteRows.length,
}, null, 2));
