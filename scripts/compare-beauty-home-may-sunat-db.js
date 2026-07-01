const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Client } = require('pg');

const RUC = '20612784192';
const COMPANY = 'BEAUTY HOME E.I.R.L.';
const CSV_FILE = '/Users/ylaurach/Library/CloudStorage/OneDrive2-Personal/zentoo/SELLERS/BEAUTY HOME/MAYO/LE206127841922026060014040001EXP2.csv';
const OUT_DIR = path.resolve('reports/beauty-home-mayo-2026');
const MONTH_START = '2026-05-01';
const MONTH_END = '2026-06-01';

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
    return {
      ...Object.fromEntries(headers.map((header, i) => [header, values[i] || ''])),
      line: index + 2,
    };
  });
}

function amount(value) {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) / 100 : 0;
}

function money(value) {
  return amount(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

function monthFromDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : '';
}

function fiscalMonth(row) {
  return monthFromDate(row.fecha_resumen) || monthFromDate(row.fecha_emision);
}

function sum(rows, selector) {
  return amount(rows.reduce((total, row) => total + Number(selector(row) || 0), 0));
}

function csvEscape(value) {
  const str = String(value ?? '');
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function writeCsv(file, rows) {
  const columns = rows[0] ? Object.keys(rows[0]) : ['empty'];
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((column) => csvEscape(row[column])).join(','));
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

function groupBy(rows, keyFn, totalFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row) || 'sin dato';
    const current = groups.get(key) || { grupo: key, count: 0, total: 0 };
    current.count += 1;
    current.total = amount(current.total + Number(totalFn(row) || 0));
    groups.set(key, current);
  }
  return Array.from(groups.values()).sort((a, b) => String(a.grupo).localeCompare(String(b.grupo)));
}

function summaryRow(label, rows, totalSelector) {
  return {
    concepto: label,
    cantidad: rows.length,
    total: sum(rows, totalSelector),
  };
}

function mdTable(rows, columns) {
  return [
    `| ${columns.map((col) => col.label).join(' | ')} |`,
    `| ${columns.map((col) => col.align || '---').join(' | ')} |`,
    ...rows.map((row) => `| ${columns.map((col) => row[col.key] ?? '').join(' | ')} |`),
  ];
}

async function main() {
  if (!process.env.DATABASE_URL_POSTGRES) throw new Error('Missing DATABASE_URL_POSTGRES');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const csvRowsAll = readCsv(CSV_FILE);
  const csvBoletas = csvRowsAll
    .filter((row) => typeCode(row) === '03')
    .map((row) => ({
      numero_completo: numeroCompleto(row),
      serie: row['Serie del CDP'],
      correlativo: docNumber(row),
      fecha_emision_csv: row['Fecha de emisión'],
      periodo: row.Periodo,
      total_csv: amount(row['Total CP']),
      estado_csv: row['Est. Comp'],
      cliente_doc_tipo: row['Tipo Doc Identidad'],
      cliente_doc: row['Nro Doc Identidad'],
      cliente_nombre: row['Apellidos Nombres/ Razón Social'],
      line: row.line,
    }));
  const csvFacturas = csvRowsAll.filter((row) => typeCode(row) === '01');
  const csvByNumber = new Map(csvBoletas.map((row) => [row.numero_completo, row]));

  const pg = new Client({ connectionString: process.env.DATABASE_URL_POSTGRES });
  await pg.connect();
  try {
    const dbResult = await pg.query(
      `select b.id, b.company_id, c.nombre as company_name, c.razon_social, c.ruc,
              b.numero_completo, b.serie, b.correlativo, b.fecha_emision, b.estado_sunat,
              b.mto_imp_venta::numeric as total_db, b.order_number,
              ds.numero_completo as resumen, ds.fecha_resumen, ds.estado as resumen_estado
       from boletas b
       join companies c on c.id = b.company_id
       left join daily_summaries ds on ds.id = b.daily_summary_id
       where c.ruc = $1
         and (
           (b.fecha_emision >= $2 and b.fecha_emision < $3)
           or (ds.fecha_resumen >= $2 and ds.fecha_resumen < $3)
           or b.numero_completo = any($4)
         )
       order by b.serie, b.correlativo`,
      [RUC, MONTH_START, MONTH_END, csvBoletas.map((row) => row.numero_completo)],
    );

    const dbRows = dbResult.rows.map((row) => ({
      ...row,
      total_db: amount(row.total_db),
      emission_month: monthFromDate(row.fecha_emision),
      fiscal_month: fiscalMonth(row),
    }));
    const dbFiscalMay = dbRows.filter((row) => row.fiscal_month === '2026-05');
    const dbComparableMay = dbFiscalMay.filter((row) => ['ACEPTADO', 'ANULADO'].includes(row.estado_sunat));
    const dbByNumber = new Map(dbComparableMay.map((row) => [row.numero_completo, row]));

    const matched = [];
    const amountDiff = [];
    const csvMissingInDb = [];
    const dbMissingInCsv = [];

    for (const csv of csvBoletas) {
      const db = dbByNumber.get(csv.numero_completo);
      if (!db) {
        csvMissingInDb.push({
          numero_completo: csv.numero_completo,
          fecha_emision_csv: csv.fecha_emision_csv,
          total_csv: csv.total_csv,
          estado_csv: csv.estado_csv,
          cliente_doc: csv.cliente_doc,
          cliente_nombre: csv.cliente_nombre,
          line: csv.line,
        });
        continue;
      }
      const diff = amount(db.total_db - csv.total_csv);
      const row = {
        numero_completo: csv.numero_completo,
        fecha_emision_csv: csv.fecha_emision_csv,
        fecha_emision_db: db.fecha_emision,
        fecha_resumen_db: db.fecha_resumen || '',
        estado_db: db.estado_sunat,
        total_csv: csv.total_csv,
        total_db: db.total_db,
        diferencia: diff,
        order_number: db.order_number || '',
        resumen: db.resumen || '',
        resumen_estado: db.resumen_estado || '',
      };
      matched.push(row);
      if (Math.abs(diff) > 0.01) amountDiff.push(row);
    }

    for (const db of dbComparableMay) {
      if (csvByNumber.has(db.numero_completo)) continue;
      dbMissingInCsv.push({
        numero_completo: db.numero_completo,
        fecha_emision_db: db.fecha_emision,
        fecha_resumen_db: db.fecha_resumen || '',
        estado_db: db.estado_sunat,
        total_db: db.total_db,
        order_number: db.order_number || '',
        resumen: db.resumen || '',
        resumen_estado: db.resumen_estado || '',
      });
    }

    const summary = [
      summaryRow('CSV SUNAT mayo boletas tipo 03', csvBoletas, (row) => row.total_csv),
      summaryRow('Nuestra DB fiscal mayo boletas comparables', dbComparableMay, (row) => row.total_db),
      summaryRow('Coinciden por numero de boleta', matched, (row) => row.total_csv),
      summaryRow('CSV SUNAT no existe en DB fiscal mayo', csvMissingInDb, (row) => row.total_csv),
      summaryRow('DB fiscal mayo no existe en CSV SUNAT', dbMissingInCsv, (row) => row.total_db),
      summaryRow('Coinciden por numero pero difiere monto', amountDiff, (row) => Math.abs(row.diferencia)),
    ];

    const dbWithOrder = dbComparableMay.filter((row) => row.order_number);
    const dbWithoutOrder = dbComparableMay.filter((row) => !row.order_number);

    writeCsv(path.join(OUT_DIR, 'beauty_home_mayo_matched.csv'), matched);
    writeCsv(path.join(OUT_DIR, 'beauty_home_mayo_csv_no_db.csv'), csvMissingInDb);
    writeCsv(path.join(OUT_DIR, 'beauty_home_mayo_db_no_csv.csv'), dbMissingInCsv);
    writeCsv(path.join(OUT_DIR, 'beauty_home_mayo_amount_diff.csv'), amountDiff);
    writeCsv(path.join(OUT_DIR, 'beauty_home_mayo_summary.csv'), summary);
    writeCsv(path.join(OUT_DIR, 'beauty_home_mayo_csv_por_serie.csv'), groupBy(csvBoletas, (row) => row.serie, (row) => row.total_csv));
    writeCsv(path.join(OUT_DIR, 'beauty_home_mayo_db_por_serie.csv'), groupBy(dbComparableMay, (row) => row.serie, (row) => row.total_db));

    const lines = [
      '# Beauty Home mayo 2026 - CSV SUNAT vs nuestra DB',
      '',
      `Generado: ${new Date().toISOString()}`,
      `Empresa: ${COMPANY}`,
      `RUC: ${RUC}`,
      `CSV SUNAT: \`${CSV_FILE}\``,
      '',
      'Solo comparo boletas tipo `03`. El CSV tambien trae facturas tipo `01`, pero quedan fuera de este reporte.',
      '',
      '## Totales',
      '',
      ...mdTable(summary.map((row) => ({
        concepto: row.concepto,
        cantidad: row.cantidad,
        total: `S/ ${money(row.total)}`,
      })), [
        { key: 'concepto', label: 'Concepto' },
        { key: 'cantidad', label: 'Cantidad', align: '---:' },
        { key: 'total', label: 'Total', align: '---:' },
      ]),
      '',
      '## Nuestra DB por orderNumber',
      '',
      '| Grupo DB fiscal mayo | Cantidad | Total |',
      '| --- | ---: | ---: |',
      `| Con orderNumber | ${dbWithOrder.length} | S/ ${money(sum(dbWithOrder, (row) => row.total_db))} |`,
      `| Sin orderNumber | ${dbWithoutOrder.length} | S/ ${money(sum(dbWithoutOrder, (row) => row.total_db))} |`,
      '',
      '## CSV SUNAT por serie',
      '',
      ...mdTable(groupBy(csvBoletas, (row) => row.serie, (row) => row.total_csv).map((row) => ({
        serie: row.grupo,
        cantidad: row.count,
        total: `S/ ${money(row.total)}`,
      })), [
        { key: 'serie', label: 'Serie' },
        { key: 'cantidad', label: 'Cantidad', align: '---:' },
        { key: 'total', label: 'Total', align: '---:' },
      ]),
      '',
      '## Nuestra DB fiscal mayo por serie',
      '',
      ...mdTable(groupBy(dbComparableMay, (row) => row.serie, (row) => row.total_db).map((row) => ({
        serie: row.grupo,
        cantidad: row.count,
        total: `S/ ${money(row.total)}`,
      })), [
        { key: 'serie', label: 'Serie' },
        { key: 'cantidad', label: 'Cantidad', align: '---:' },
        { key: 'total', label: 'Total', align: '---:' },
      ]),
      '',
      '## Facturas detectadas en CSV, no comparadas aqui',
      '',
      `El CSV trae ${csvFacturas.length} factura(s) tipo 01 por S/ ${money(sum(csvFacturas, (row) => amount(row['Total CP'])))}.`,
      '',
      '## Archivos detalle',
      '',
      '- `beauty_home_mayo_matched.csv`',
      '- `beauty_home_mayo_csv_no_db.csv`',
      '- `beauty_home_mayo_db_no_csv.csv`',
      '- `beauty_home_mayo_amount_diff.csv`',
      '- `beauty_home_mayo_summary.csv`',
    ];

    fs.writeFileSync(path.join(OUT_DIR, 'beauty_home_mayo_reporte.md'), `${lines.join('\n')}\n`);
    console.log(lines.join('\n'));
  } finally {
    await pg.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
