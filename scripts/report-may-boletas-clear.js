const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Client } = require('pg');

const CSV_FILE = '/Users/ylaurach/Library/CloudStorage/OneDrive2-Personal/zentoo/SELLERS/LIMBO/MAYO/LE206078091362026060014040001EXP2.csv';
const RUC = '20607809136';
const MONTH = '2026-05';
const OUT_DIR = path.resolve('reports/mayo-2026-boletas-claro');

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
  return lines.slice(1).filter(Boolean).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, i) => [header, values[i] || '']));
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

function amount(row, key = 'Total CP') {
  return round2(row[key]);
}

function sum(rows, selector) {
  return round2(rows.reduce((total, row) => total + Number(selector(row) || 0), 0));
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

  const sunat = readCsv(CSV_FILE)
    .filter((row) => typeCode(row) === '03')
    .map((row) => ({
      numero_completo: numeroCompleto(row),
      fecha_csv: row['Fecha de emisión'],
      total_csv: amount(row),
      periodo: row.Periodo,
    }));
  const sunatMap = new Map(sunat.map((row) => [row.numero_completo, row]));

  const client = new Client({ connectionString: process.env.DATABASE_URL_POSTGRES });
  await client.connect();
  try {
    const result = await client.query(
      `select b.id, c.nombre as company_name, b.numero_completo, b.fecha_emision,
              b.estado_sunat, b.mto_imp_venta::numeric as total_db, b.order_number,
              ds.numero_completo as resumen, ds.fecha_resumen
       from boletas b
       join companies c on c.id = b.company_id
       left join daily_summaries ds on ds.id = b.daily_summary_id
       where c.ruc = $1
         and (
           (b.fecha_emision >= '2026-05-01' and b.fecha_emision < '2026-06-01')
           or (ds.fecha_resumen >= '2026-05-01' and ds.fecha_resumen < '2026-06-01')
         )
       order by b.serie, b.correlativo`,
      [RUC],
    );

    const db = result.rows.map((row) => ({
      ...row,
      total_db: round2(row.total_db),
      fiscal_month: fiscalMonth(row),
      emission_month: monthFromDate(row.fecha_emision),
    }));

    const dbFiscalAll = db.filter((row) => row.fiscal_month === MONTH);
    const dbFiscalComparable = dbFiscalAll.filter((row) => ['ACEPTADO', 'ANULADO'].includes(row.estado_sunat));
    const dbFiscalPending = dbFiscalAll.filter((row) => row.estado_sunat === 'PENDIENTE');

    const exact = [];
    const amountMismatch = [];
    const dbNotInSunat = [];
    for (const row of dbFiscalComparable) {
      const match = sunatMap.get(row.numero_completo);
      if (!match) {
        dbNotInSunat.push(row);
      } else if (round2(row.total_db - match.total_csv) !== 0) {
        amountMismatch.push({ ...row, total_csv: match.total_csv, diferencia: round2(row.total_db - match.total_csv) });
      } else {
        exact.push(row);
      }
    }

    const comparableMap = new Map(dbFiscalComparable.map((row) => [row.numero_completo, row]));
    const sunatNotInDb = sunat.filter((row) => !comparableMap.has(row.numero_completo));
    const dbRowsThatAreInSunat = dbFiscalComparable.filter((row) => sunatMap.has(row.numero_completo));

    const oldEmissionComparable = db
      .filter((row) => row.emission_month === MONTH)
      .filter((row) => ['ACEPTADO', 'ANULADO'].includes(row.estado_sunat));
    const fiscalJuneByEmissionMay = oldEmissionComparable.filter((row) => row.fiscal_month !== MONTH);

    const lines = [
      '# Mayo 2026 - comparacion clara de boletas',
      '',
      `Generado: ${new Date().toISOString()}`,
      `RUC: ${RUC}`,
      `CSV SUNAT mayo: \`${CSV_FILE}\``,
      '',
      '## Regla',
      '',
      'Para comparar con el CSV mensual de SUNAT, uso el periodo fiscal de la boleta:',
      '',
      '- Si la boleta tiene resumen SUNAT, manda `fecha_resumen`.',
      '- Si no tiene resumen, manda `fecha_emision`.',
      '- Solo comparo contra SUNAT las boletas `ACEPTADO` y `ANULADO`; `PENDIENTE` no deberia estar en el CSV.',
      '',
      '## Resultado principal',
      '',
      '| Fuente | Boletas | Total | Que significa |',
      '| --- | ---: | ---: | --- |',
      `| SUNAT CSV mayo | ${sunat.length} | S/ ${money(sum(sunat, (row) => row.total_csv))} | Lo que SUNAT lista para periodo 202605 |`,
      `| Sistema que tambien esta en CSV mayo | ${dbRowsThatAreInSunat.length} | S/ ${money(sum(dbRowsThatAreInSunat, (row) => row.total_db))} | Mismas boletas del CSV, valuadas con monto del sistema |`,
      `| Diferencia sistema - SUNAT en esas mismas boletas | ${dbRowsThatAreInSunat.length - sunat.length} | S/ ${money(sum(dbRowsThatAreInSunat, (row) => row.total_db) - sum(sunat, (row) => row.total_csv))} | Diferencia real de monto, no de cantidad |`,
      '',
      '## Explicacion de la diferencia',
      '',
      '| Grupo | Boletas | Impacto |',
      '| --- | ---: | ---: |',
      `| Coinciden exacto en ambos | ${exact.length} | S/ ${money(sum(exact, (row) => row.total_db))} |`,
      `| No cuentan para mayo: estan en sistema, pero no en CSV mayo | ${dbNotInSunat.length} | S/ ${money(sum(dbNotInSunat, (row) => row.total_db))} |`,
      `| Estan en ambos, pero SUNAT tiene otro total | ${amountMismatch.length} | S/ ${money(sum(amountMismatch, (row) => row.diferencia))} |`,
      `| Estan en CSV mayo pero no en sistema fiscal comparable | ${sunatNotInDb.length} | S/ ${money(sum(sunatNotInDb, (row) => row.total_csv))} |`,
      '',
      '## No comparar contra SUNAT',
      '',
      '| Grupo | Boletas | Total | Motivo |',
      '| --- | ---: | ---: | --- |',
      `| PENDIENTE en sistema mayo fiscal | ${dbFiscalPending.length} | S/ ${money(sum(dbFiscalPending, (row) => row.total_db))} | Todavia no esta aceptado/anulado por SUNAT |`,
      `| Fecha emision mayo, pero periodo fiscal no mayo | ${fiscalJuneByEmissionMay.length} | S/ ${money(sum(fiscalJuneByEmissionMay, (row) => row.total_db))} | Estas eran las que inflaban mayo antes; pertenecen a otro periodo fiscal |`,
      '',
      '## Detalle: no cuentan para mayo porque no estan en CSV mayo',
      '',
      '| Boleta | Fecha emision | Fecha resumen | Estado | Total | Resumen | Orden |',
      '| --- | --- | --- | --- | ---: | --- | --- |',
      ...dbNotInSunat.map((row) => `| ${row.numero_completo} | ${row.fecha_emision || '-'} | ${row.fecha_resumen || '-'} | ${row.estado_sunat} | S/ ${money(row.total_db)} | ${row.resumen || '-'} | ${row.order_number || '-'} |`),
      '',
      '## Detalle: total distinto',
      '',
      '| Boleta | Estado | Total sistema | Total SUNAT | Diferencia | Resumen | Orden |',
      '| --- | --- | ---: | ---: | ---: | --- | --- |',
      ...amountMismatch.map((row) => `| ${row.numero_completo} | ${row.estado_sunat} | S/ ${money(row.total_db)} | S/ ${money(row.total_csv)} | S/ ${money(row.diferencia)} | ${row.resumen || '-'} | ${row.order_number || '-'} |`),
    ];

    const detail = [
      ...dbNotInSunat.map((row) => ({
        grupo: 'Sistema fiscal mayo pero no CSV mayo',
        boleta: row.numero_completo,
        estado: row.estado_sunat,
        fecha_emision: row.fecha_emision,
        fecha_resumen: row.fecha_resumen || '',
        total_sistema: row.total_db,
        total_sunat: '',
        diferencia: row.total_db,
        resumen: row.resumen || '',
        order_number: row.order_number || '',
      })),
      ...amountMismatch.map((row) => ({
        grupo: 'Total distinto',
        boleta: row.numero_completo,
        estado: row.estado_sunat,
        fecha_emision: row.fecha_emision,
        fecha_resumen: row.fecha_resumen || '',
        total_sistema: row.total_db,
        total_sunat: row.total_csv,
        diferencia: row.diferencia,
        resumen: row.resumen || '',
        order_number: row.order_number || '',
      })),
    ];

    writeCsv(path.join(OUT_DIR, 'detalle_mayo.csv'), detail);
    fs.writeFileSync(path.join(OUT_DIR, 'reporte_mayo_claro.md'), `${lines.join('\n')}\n`);
    console.log(lines.join('\n'));
    console.log(`\nReporte: ${path.join(OUT_DIR, 'reporte_mayo_claro.md')}`);
    console.log(`Detalle: ${path.join(OUT_DIR, 'detalle_mayo.csv')}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
