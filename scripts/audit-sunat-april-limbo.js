const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Client } = require('pg');

const csvPath = process.argv[2] || '/Users/ylaurach/Downloads/LE206078091362026060014040001EXP2.csv';
const outDir = path.resolve('reports/sunat-abril-2026-limbo');
const RUC = '20607809136';

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
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
  });
}

function money(value) {
  return Number(value || 0);
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function docNumber(row) {
  return String(row['Nro CP o Doc. Nro Inicial (Rango)'] || '').padStart(6, '0');
}

function numeroCompleto(row) {
  return `${row['Serie del CDP']}-${docNumber(row)}`;
}

function total(rows) {
  return round2(rows.reduce((sum, row) => sum + money(row['Total CP']), 0));
}

function writeCsv(file, rows) {
  const headers = rows.length ? Object.keys(rows[0]) : ['empty'];
  const escape = (value) => {
    const str = String(value ?? '');
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  fs.writeFileSync(file, [headers.join(','), ...rows.map((row) => headers.map((h) => escape(row[h])).join(','))].join('\n'));
}

async function queryBoletaMatches(client, companyId, docs) {
  if (!docs.length) return [];
  const result = await client.query(
    `select id, company_id, numero_completo, fecha_emision, estado_sunat, mto_imp_venta, order_number, created_at
     from boletas
     where company_id = $1 and numero_completo = any($2)
     order by numero_completo`,
    [companyId, docs],
  );
  return result.rows;
}

async function queryFacturaMatches(client, companyId, docs) {
  if (!docs.length) return [];
  const result = await client.query(
    `select id, company_id, numero_completo, fecha_emision, estado, order_number, created_at
     from facturas
     where company_id = $1 and numero_completo = any($2)
     order by numero_completo`,
    [companyId, docs],
  );
  return result.rows;
}

async function queryCreditNoteMatches(client, companyId, docs) {
  if (!docs.length) return [];
  const result = await client.query(
    `select id, company_id, numero_completo, fecha_emision, estado_sunat, mto_imp_venta, num_doc_afectado, created_at
     from credit_notes
     where company_id = $1 and numero_completo = any($2)
     order by numero_completo`,
    [companyId, docs],
  );
  return result.rows;
}

async function main() {
  const rows = readCsv(csvPath);
  const periods = [...new Set(rows.map((row) => row.Periodo))];
  const boletas = rows.filter((row) => String(row['Tipo CP/Doc.']).padStart(2, '0') === '03');
  const facturas = rows.filter((row) => String(row['Tipo CP/Doc.']).padStart(2, '0') === '01');
  const notas = rows.filter((row) => String(row['Tipo CP/Doc.']).padStart(2, '0') === '07');

  const client = new Client({ connectionString: process.env.DATABASE_URL_POSTGRES });
  await client.connect();
  try {
    const companyResult = await client.query('select id, nombre, razon_social, ruc from companies where ruc = $1', [RUC]);
    const company = companyResult.rows[0];
    if (!company) throw new Error(`No existe company con RUC ${RUC}`);

    const boletaDocs = boletas.map(numeroCompleto);
    const facturaDocs = facturas.map(numeroCompleto);
    const notaDocs = notas.map(numeroCompleto);

    const boletaMatches = await queryBoletaMatches(client, company.id, boletaDocs);
    const facturaMatches = await queryFacturaMatches(client, company.id, facturaDocs);
    const notaMatches = await queryCreditNoteMatches(client, company.id, notaDocs);
    const dbAprilBoletas = await client.query(
      `select b.id, b.numero_completo, b.fecha_emision, b.estado_sunat, b.mto_imp_venta, b.order_number,
              ds.numero_completo as resumen, ds.fecha_resumen, ds.estado as resumen_estado, ds.response_code, ds.ticket
       from boletas b
       left join daily_summaries ds on ds.id = b.daily_summary_id
       where b.company_id = $1 and b.fecha_emision >= '2026-04-01' and b.fecha_emision < '2026-05-01'
       order by b.fecha_emision, b.numero_completo`,
      [company.id],
    );
    const dbAprilFacturas = await client.query(
      `select id, numero_completo, fecha_emision, estado, order_number
       from facturas
       where company_id = $1 and fecha_emision >= '2026-04-01' and fecha_emision < '2026-05-01'
       order by fecha_emision, numero_completo`,
      [company.id],
    );
    const targetThree = await client.query(
      `select b.id, b.numero_completo, b.fecha_emision, b.estado_sunat, b.mto_imp_venta, b.order_number,
              ds.numero_completo as resumen, ds.fecha_resumen, ds.estado as resumen_estado, ds.response_code, ds.response_description, ds.ticket
       from boletas b
       left join daily_summaries ds on ds.id = b.daily_summary_id
       where b.company_id = $1 and b.numero_completo in ('B001-000232', 'B001-000233', 'B001-000234')
       order by b.numero_completo`,
      [company.id],
    );

    const boletaMatchSet = new Set(boletaMatches.map((row) => row.numero_completo));
    const facturaMatchSet = new Set(facturaMatches.map((row) => row.numero_completo));
    const notaMatchSet = new Set(notaMatches.map((row) => row.numero_completo));
    const csvBoletaSet = new Set(boletaDocs);
    const csvFacturaSet = new Set(facturaDocs);

    const boletasMissingDb = boletas
      .filter((row) => !boletaMatchSet.has(numeroCompleto(row)))
      .map((row) => ({
        comprobante: numeroCompleto(row),
        fecha_sunat: row['Fecha de emisión'],
        total_sunat: row['Total CP'],
        cliente_doc: row['Nro Doc Identidad'],
        cliente: row['Apellidos Nombres/ Razón Social'],
      }));

    const facturasMissingDb = facturas
      .filter((row) => !facturaMatchSet.has(numeroCompleto(row)))
      .map((row) => ({
        comprobante: numeroCompleto(row),
        fecha_sunat: row['Fecha de emisión'],
        total_sunat: row['Total CP'],
        cliente_doc: row['Nro Doc Identidad'],
        cliente: row['Apellidos Nombres/ Razón Social'],
      }));

    const dbAprilBoletasNotInCsv = dbAprilBoletas.rows
      .filter((row) => !csvBoletaSet.has(row.numero_completo))
      .map((row) => ({
        comprobante: row.numero_completo,
        fecha_db: row.fecha_emision,
        total_db: row.mto_imp_venta,
        estado_db: row.estado_sunat,
        order_number: row.order_number,
        resumen: row.resumen,
        fecha_resumen: row.fecha_resumen,
        resumen_estado: row.resumen_estado,
        response_code: row.response_code,
        ticket: row.ticket,
      }));

    const dbAprilFacturasNotInCsv = dbAprilFacturas.rows
      .filter((row) => !csvFacturaSet.has(row.numero_completo))
      .map((row) => ({
        comprobante: row.numero_completo,
        fecha_db: row.fecha_emision,
        estado_db: row.estado,
        order_number: row.order_number,
      }));

    fs.mkdirSync(outDir, { recursive: true });
    writeCsv(path.join(outDir, 'boletas_sunat_abril_no_en_db.csv'), boletasMissingDb);
    writeCsv(path.join(outDir, 'facturas_sunat_abril_no_en_db.csv'), facturasMissingDb);
    writeCsv(path.join(outDir, 'boletas_db_abril_no_en_sunat_csv.csv'), dbAprilBoletasNotInCsv);
    writeCsv(path.join(outDir, 'facturas_db_abril_no_en_sunat_csv.csv'), dbAprilFacturasNotInCsv);

    const byType = [
      ['Boletas 03', boletas.length, total(boletas), boletaMatches.length, boletasMissingDb.length],
      ['Facturas 01', facturas.length, total(facturas), facturaMatches.length, facturasMissingDb.length],
      ['Notas 07', notas.length, total(notas), notaMatches.length, notas.length - notaMatches.length],
    ];

    const lines = [
      '# Auditoria SUNAT abril 2026 - Limbo',
      '',
      `Archivo: ${csvPath}`,
      `RUC: ${company.ruc} - ${company.razon_social}`,
      `Periodos detectados en CSV: ${periods.join(', ')}`,
      '',
      '## Resumen CSV vs DB',
      '',
      '| Tipo | CSV cantidad | CSV total | Encontrados en DB | No encontrados en DB |',
      '| --- | ---: | ---: | ---: | ---: |',
      ...byType.map(([label, count, amount, found, missing]) => `| ${label} | ${count} | S/ ${amount.toFixed(2)} | ${found} | ${missing} |`),
      '',
      '## Las 3 boletas consultadas',
      '',
      '| Comprobante | Fecha DB | Total DB | Order | Estado | Resumen | Fecha resumen | Resumen estado | Response | Ticket |',
      '| --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- |',
      ...targetThree.rows.map((row) => `| ${row.numero_completo} | ${row.fecha_emision} | S/ ${Number(row.mto_imp_venta).toFixed(2)} | ${row.order_number || '-'} | ${row.estado_sunat || '-'} | ${row.resumen || '-'} | ${row.fecha_resumen || '-'} | ${row.resumen_estado || '-'} | ${row.response_code || '-'} | ${row.ticket || '-'} |`),
      '',
      'Conclusion: esas 3 no estan en el CSV de abril. En DB pertenecen a mayo por fecha_emision 2026-05-26 y vienen de Falabella/Limbo.',
      '',
      '## Archivos de detalle',
      '',
      '- boletas_sunat_abril_no_en_db.csv',
      '- facturas_sunat_abril_no_en_db.csv',
      '- boletas_db_abril_no_en_sunat_csv.csv',
      '- facturas_db_abril_no_en_sunat_csv.csv',
      '',
      `DB boletas abril que no aparecen en este CSV: ${dbAprilBoletasNotInCsv.length}`,
      `DB facturas abril que no aparecen en este CSV: ${dbAprilFacturasNotInCsv.length}`,
    ];

    fs.writeFileSync(path.join(outDir, 'reporte.md'), `${lines.join('\n')}\n`);
    console.log(JSON.stringify({
      outDir,
      periods,
      csv: {
        rows: rows.length,
        boletas: boletas.length,
        boletasTotal: total(boletas),
        facturas: facturas.length,
        facturasTotal: total(facturas),
        notas: notas.length,
        notasTotal: total(notas),
      },
      dbMatches: {
        boletas: boletaMatches.length,
        facturas: facturaMatches.length,
        notas: notaMatches.length,
      },
      missingInDb: {
        boletas: boletasMissingDb.length,
        facturas: facturasMissingDb.length,
        notas: notas.length - notaMatches.length,
      },
      dbAprilNotInCsv: {
        boletas: dbAprilBoletasNotInCsv.length,
        facturas: dbAprilFacturasNotInCsv.length,
      },
      targetThree: targetThree.rows,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
