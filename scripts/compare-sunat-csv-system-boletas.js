const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Client } = require('pg');

const SELLER_DIR = '/Users/ylaurach/Library/CloudStorage/OneDrive2-Personal/zentoo/SELLERS/LIMBO';
const RUC = '20607809136';
const OUT_DIR = path.resolve('reports/sunat-csv-vs-system-boletas');

const MONTHS = [
  { key: 'abril', label: 'Abril 2026', value: '2026-04', folder: 'ABRIL', period: '202604' },
  { key: 'mayo', label: 'Mayo 2026', value: '2026-05', folder: 'MAYO', period: '202605' },
  { key: 'junio', label: 'Junio 2026', value: '2026-06', folder: 'JUNIO', period: '202606' },
];

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
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
  const lines = text.split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((line, index) => {
    const values = parseCsvLine(line);
    return Object.assign(Object.fromEntries(headers.map((header, i) => [header, values[i] || ''])), {
      __line: index + 2,
      __file: file,
    });
  });
}

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function money(value) {
  return round2(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function monthFromDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : null;
}

function fiscalMonth(row) {
  return monthFromDate(row.fecha_resumen) || monthFromDate(row.fecha_emision);
}

function typeCode(row) {
  return String(row['Tipo CP/Doc.'] || '').padStart(2, '0');
}

function docNumber(row) {
  return String(row['Nro CP o Doc. Nro Inicial (Rango)'] || '').padStart(6, '0');
}

function numeroCompleto(row) {
  return `${row['Serie del CDP']}-${docNumber(row)}`;
}

function amount(row) {
  return round2(row['Total CP']);
}

function sum(rows, selector) {
  return round2(rows.reduce((total, row) => total + Number(selector(row) || 0), 0));
}

function csvBoletas(file, monthKey) {
  return readCsv(file)
    .filter((row) => typeCode(row) === '03')
    .map((row) => ({
      key: numeroCompleto(row),
      numero_completo: numeroCompleto(row),
      serie: row['Serie del CDP'],
      correlativo: docNumber(row),
      fecha_emision_csv: row['Fecha de emisión'],
      periodo: row.Periodo,
      total_csv: amount(row),
      estado_csv: row['Est. Comp'],
      month_key: monthKey,
      line: row.__line,
    }));
}

function groupSummary(rows, totalKey) {
  return {
    count: rows.length,
    total: sum(rows, (row) => row[totalKey]),
  };
}

function writeCsv(file, rows) {
  const columns = rows[0] ? Object.keys(rows[0]) : ['empty'];
  const escape = (value) => {
    const str = String(value ?? '');
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((column) => escape(row[column])).join(','));
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

async function main() {
  if (!process.env.DATABASE_URL_POSTGRES) throw new Error('Missing DATABASE_URL_POSTGRES');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const files = Object.fromEntries(MONTHS.map((month) => [
    month.key,
    path.join(SELLER_DIR, month.folder, 'LE206078091362026060014040001EXP2.csv'),
  ]));
  const csvByMonth = Object.fromEntries(MONTHS.map((month) => [month.key, csvBoletas(files[month.key], month.key)]));

  const client = new Client({ connectionString: process.env.DATABASE_URL_POSTGRES });
  await client.connect();
  try {
    const dbResult = await client.query(
      `select b.id, b.company_id, c.nombre as company_name, c.razon_social, c.ruc,
              b.numero_completo, b.serie, b.correlativo, b.fecha_emision, b.estado_sunat,
              b.mto_imp_venta::numeric as total_db, b.order_number,
              ds.numero_completo as resumen, ds.fecha_resumen, ds.estado as resumen_estado
       from boletas b
       join companies c on c.id = b.company_id
       left join daily_summaries ds on ds.id = b.daily_summary_id
       where c.ruc = $1
         and (
           (b.fecha_emision >= '2026-04-01' and b.fecha_emision < '2026-07-01')
           or (ds.fecha_resumen >= '2026-04-01' and ds.fecha_resumen < '2026-07-01')
         )
       order by b.fecha_emision, b.serie, b.correlativo`,
      [RUC],
    );

    const dbRows = dbResult.rows.map((row) => ({
      ...row,
      key: row.numero_completo,
      total_db: round2(row.total_db),
      emission_month: monthFromDate(row.fecha_emision),
      fiscal_month: fiscalMonth(row),
    }));

    const lines = [
      '# Comparacion boletas CSV SUNAT vs sistema',
      '',
      `Generado: ${new Date().toISOString()}`,
      `RUC: ${RUC}`,
      `Carpeta CSV: \`${SELLER_DIR}\``,
      '',
      'Regla usada para el corte fiscal del sistema: `summaryFechaResumen` si existe; si no existe, `fechaEmision`.',
      '',
      '## Totales por mes',
      '',
      '| Mes | CSV SUNAT boletas | CSV total | Sistema fecha emision boletas | Sistema fecha emision total | Sistema fiscal boletas | Sistema fiscal total | Fiscal aceptado/anulado | Fiscal aceptado/anulado total | Diferencia fiscal comparable vs CSV |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ];

    const detailRows = [];

    for (const month of MONTHS) {
      const csvRows = csvByMonth[month.key];
      const csvMap = new Map(csvRows.map((row) => [row.key, row]));
      const byEmission = dbRows.filter((row) => row.emission_month === month.value);
      const byFiscal = dbRows.filter((row) => row.fiscal_month === month.value);
      const comparableFiscal = byFiscal.filter((row) => ['ACEPTADO', 'ANULADO'].includes(row.estado_sunat));
      const csvSummary = groupSummary(csvRows, 'total_csv');
      const emissionSummary = groupSummary(byEmission, 'total_db');
      const fiscalSummary = groupSummary(byFiscal, 'total_db');
      const comparableSummary = groupSummary(comparableFiscal, 'total_db');
      const comparableDiff = round2(comparableSummary.total - csvSummary.total);

      lines.push(`| ${month.label} | ${csvSummary.count} | S/ ${money(csvSummary.total)} | ${emissionSummary.count} | S/ ${money(emissionSummary.total)} | ${fiscalSummary.count} | S/ ${money(fiscalSummary.total)} | ${comparableSummary.count} | S/ ${money(comparableSummary.total)} | S/ ${money(comparableDiff)} |`);

      const dbComparableMap = new Map(comparableFiscal.map((row) => [row.key, row]));
      const missingInCsv = comparableFiscal
        .filter((row) => !csvMap.has(row.key))
        .map((row) => ({
          mes: month.label,
          tipo: 'Sistema fiscal comparable no esta en CSV del mes',
          numero_completo: row.key,
          fecha_emision_db: row.fecha_emision,
          fecha_resumen_db: row.fecha_resumen || '',
          estado_db: row.estado_sunat,
          total_db: row.total_db,
          total_csv: '',
          company: row.company_name,
          resumen: row.resumen || '',
          order_number: row.order_number || '',
        }));
      const missingInDb = csvRows
        .filter((row) => !dbComparableMap.has(row.key))
        .map((row) => ({
          mes: month.label,
          tipo: 'CSV del mes no esta en sistema fiscal comparable',
          numero_completo: row.key,
          fecha_emision_db: '',
          fecha_resumen_db: '',
          estado_db: '',
          total_db: '',
          total_csv: row.total_csv,
          company: '',
          resumen: '',
          order_number: '',
        }));
      const amountDiff = comparableFiscal
        .filter((row) => csvMap.has(row.key) && round2(row.total_db - csvMap.get(row.key).total_csv) !== 0)
        .map((row) => ({
          mes: month.label,
          tipo: 'Existe en ambos pero total difiere',
          numero_completo: row.key,
          fecha_emision_db: row.fecha_emision,
          fecha_resumen_db: row.fecha_resumen || '',
          estado_db: row.estado_sunat,
          total_db: row.total_db,
          total_csv: csvMap.get(row.key).total_csv,
          company: row.company_name,
          resumen: row.resumen || '',
          order_number: row.order_number || '',
        }));

      detailRows.push(...missingInCsv, ...missingInDb, ...amountDiff);

      lines.push('');
      lines.push(`### ${month.label}`);
      lines.push('');
      lines.push(`- CSV SUNAT: ${csvSummary.count} boletas, S/ ${money(csvSummary.total)}.`);
      lines.push(`- Sistema por fecha de emision: ${emissionSummary.count} boletas, S/ ${money(emissionSummary.total)}.`);
      lines.push(`- Sistema por periodo fiscal: ${fiscalSummary.count} boletas, S/ ${money(fiscalSummary.total)}.`);
      lines.push(`- Sistema fiscal comparable con SUNAT (ACEPTADO/ANULADO): ${comparableSummary.count} boletas, S/ ${money(comparableSummary.total)}.`);
      lines.push(`- Diferencia comparable fiscal - CSV: ${comparableSummary.count - csvSummary.count} boletas, S/ ${money(comparableDiff)}.`);
      lines.push(`- Detalles: ${missingInCsv.length} del sistema no estan en CSV, ${missingInDb.length} del CSV no estan en sistema comparable, ${amountDiff.length} con total distinto.`);
      lines.push('');
    }

    writeCsv(path.join(OUT_DIR, 'detalle_diferencias_boletas.csv'), detailRows);
    fs.writeFileSync(path.join(OUT_DIR, 'reporte.md'), `${lines.join('\n')}\n`);
    console.log(lines.join('\n'));
    console.log(`\nReporte: ${path.join(OUT_DIR, 'reporte.md')}`);
    console.log(`Detalle: ${path.join(OUT_DIR, 'detalle_diferencias_boletas.csv')}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
