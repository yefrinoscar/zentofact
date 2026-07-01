const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Client } = require('pg');

const RUC = '20612784192';
const OUT_DIR = path.resolve('reports/beauty-home-mayo-2026');
const MISSING_FILE = path.join(OUT_DIR, 'beauty_home_mayo_csv_no_db.csv');

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

function amount(value) {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) / 100 : 0;
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

async function main() {
  const missing = readCsv(MISSING_FILE);
  const docs = missing.map((row) => row.numero_completo);
  const pg = new Client({ connectionString: process.env.DATABASE_URL_POSTGRES });
  await pg.connect();
  try {
    const result = await pg.query(
      `select b.id, c.nombre as company_name, c.ruc, b.numero_completo, b.fecha_emision,
              b.estado_sunat, b.mto_imp_venta::numeric as total_db, b.order_number,
              ds.numero_completo as resumen, ds.fecha_resumen, ds.estado as resumen_estado
       from boletas b
       join companies c on c.id = b.company_id
       left join daily_summaries ds on ds.id = b.daily_summary_id
       where c.ruc = $1
         and b.numero_completo = any($2)
       order by b.numero_completo`,
      [RUC, docs],
    );
    const foundMap = new Map(result.rows.map((row) => [row.numero_completo, row]));
    const rows = missing.map((row) => {
      const found = foundMap.get(row.numero_completo);
      return {
        numero_completo: row.numero_completo,
        csv_fecha: row.fecha_emision_csv,
        csv_total: row.total_csv,
        encontrado_en_db: found ? 'SI' : 'NO',
        db_fecha_emision: found?.fecha_emision || '',
        db_fecha_resumen: found?.fecha_resumen || '',
        db_estado: found?.estado_sunat || '',
        db_total: found ? amount(found.total_db) : '',
        order_number: found?.order_number || '',
        resumen: found?.resumen || '',
        resumen_estado: found?.resumen_estado || '',
      };
    });
    writeCsv(path.join(OUT_DIR, 'beauty_home_eb01_missing_search_anywhere.csv'), rows);
    console.log(JSON.stringify({
      searched: missing.length,
      foundAnywhere: result.rows.length,
      notFoundAnywhere: missing.length - result.rows.length,
    }, null, 2));
  } finally {
    await pg.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
