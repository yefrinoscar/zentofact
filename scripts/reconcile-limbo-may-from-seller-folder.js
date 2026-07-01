const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Client } = require('pg');

const SELLER_DIR = '/Users/ylaurach/Library/CloudStorage/OneDrive2-Personal/zentoo/SELLERS/LIMBO';
const RUC = '20607809136';
const OUT_DIR = path.resolve('reports/sunat-mayo-2026-limbo-onedrive');

const FILES = {
  abril: path.join(SELLER_DIR, 'ABRIL', 'LE206078091362026060014040001EXP2.csv'),
  mayo: path.join(SELLER_DIR, 'MAYO', 'LE206078091362026060014040001EXP2.csv'),
  junio: path.join(SELLER_DIR, 'JUNIO', 'LE206078091362026060014040001EXP2.csv'),
};

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
  return Number(row['Total CP'] || 0);
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function sum(rows, selector = (row) => Number(row.total || row.mto_imp_venta || row.total_sunat || 0)) {
  return round2(rows.reduce((total, row) => total + Number(selector(row) || 0), 0));
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function groupRows(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const current = map.get(key) || [];
    current.push(row);
    map.set(key, current);
  }
  return map;
}

function writeCsv(file, rows, headers) {
  const columns = headers || (rows[0] ? Object.keys(rows[0]) : ['empty']);
  const escape = (value) => {
    const str = String(value ?? '');
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => escape(row[column])).join(','));
  }
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

function sunatBoletas(rows, monthLabel) {
  return rows
    .filter((row) => typeCode(row) === '03')
    .map((row) => ({
      key: numeroCompleto(row),
      numero_completo: numeroCompleto(row),
      serie: row['Serie del CDP'],
      correlativo: docNumber(row),
      fecha_sunat: row['Fecha de emisión'],
      periodo: row.Periodo,
      total_sunat: round2(amount(row)),
      cliente_doc_tipo: row['Tipo Doc Identidad'],
      cliente_doc: row['Nro Doc Identidad'],
      cliente: row['Apellidos Nombres/ Razón Social'],
      estado_comp: row['Est. Comp'],
      mes_csv: monthLabel,
      line: row.__line,
    }));
}

function sunatNotas(rows, monthLabel) {
  return rows
    .filter((row) => typeCode(row) === '07')
    .map((row) => ({
      nota: numeroCompleto(row),
      fecha_nota: row['Fecha de emisión'],
      total_nota: round2(amount(row)),
      affected: `${row['Serie CP Modificado']}-${String(row['Nro CP Modificado'] || '').padStart(6, '0')}`,
      affected_tipo: row['Tipo CP Modificado'],
      mes_csv: monthLabel,
    }));
}

async function main() {
  const csv = Object.fromEntries(Object.entries(FILES).map(([key, file]) => [key, readCsv(file)]));
  const csvSummary = Object.fromEntries(Object.entries(csv).map(([key, rows]) => {
    const byType = {};
    for (const row of rows) {
      const code = typeCode(row);
      byType[code] ||= { count: 0, total: 0 };
      byType[code].count += 1;
      byType[code].total = round2(byType[code].total + amount(row));
    }
    return [key, { file: FILES[key], rows: rows.length, periods: [...new Set(rows.map((row) => row.Periodo))], byType }];
  }));

  const sunat = {
    abril: sunatBoletas(csv.abril, 'abril'),
    mayo: sunatBoletas(csv.mayo, 'mayo'),
    junio: sunatBoletas(csv.junio, 'junio'),
  };
  const notes = {
    mayo: sunatNotas(csv.mayo, 'mayo'),
    junio: sunatNotas(csv.junio, 'junio'),
  };

  const sunatMayMap = new Map(sunat.mayo.map((row) => [row.key, row]));
  const sunatJuneMap = new Map(sunat.junio.map((row) => [row.key, row]));
  const sunatAprilMap = new Map(sunat.abril.map((row) => [row.key, row]));

  const client = new Client({ connectionString: process.env.DATABASE_URL_POSTGRES });
  await client.connect();
  try {
    const db = await client.query(
      `select b.id, b.company_id, co.nombre as company_name, co.razon_social, co.ruc,
              b.numero_completo, b.serie, b.correlativo, b.fecha_emision, b.estado_sunat,
              b.mto_imp_venta::numeric as total_db, b.order_number, b.created_at,
              ds.numero_completo as resumen, ds.fecha_resumen, ds.estado as resumen_estado,
              ds.response_code, ds.ticket
       from boletas b
       join companies co on co.id = b.company_id
       left join daily_summaries ds on ds.id = b.daily_summary_id
       where co.ruc = $1
         and b.fecha_emision >= '2026-05-01'
         and b.fecha_emision < '2026-06-01'
       order by b.company_id, b.serie, b.correlativo`,
      [RUC],
    );

    const dbRows = db.rows.map((row) => ({
      ...row,
      key: row.numero_completo,
      total_db: round2(row.total_db),
    }));
    const comparableDbRows = dbRows.filter((row) => ['ACEPTADO', 'ANULADO'].includes(row.estado_sunat));
    const comparableKeys = new Set(comparableDbRows.map((row) => row.key));
    const pendingDbRows = dbRows.filter((row) => row.estado_sunat === 'PENDIENTE');
    const dbMap = new Map(dbRows.map((row) => [row.key, row]));

    const matched = [];
    const dbNotInMay = [];
    for (const row of dbRows) {
      const m = sunatMayMap.get(row.key);
      if (m) {
        matched.push({
          numero_completo: row.key,
          fecha_db: row.fecha_emision,
          fecha_sunat: m.fecha_sunat,
          total_db: row.total_db,
          total_sunat: m.total_sunat,
          diferencia: round2(row.total_db - m.total_sunat),
          estado_db: row.estado_sunat,
          company: row.company_name,
          order_number: row.order_number,
          resumen: row.resumen,
        });
      } else {
        const june = sunatJuneMap.get(row.key);
        const april = sunatAprilMap.get(row.key);
        dbNotInMay.push({
          numero_completo: row.key,
          fecha_db: row.fecha_emision,
          total_db: row.total_db,
          estado_db: row.estado_sunat,
          company: row.company_name,
          order_number: row.order_number,
          resumen: row.resumen || '',
          fecha_resumen: row.fecha_resumen || '',
          en_csv_abril: april ? 'SI' : 'NO',
          fecha_csv_abril: april?.fecha_sunat || '',
          total_csv_abril: april?.total_sunat ?? '',
          en_csv_junio: june ? 'SI' : 'NO',
          fecha_csv_junio: june?.fecha_sunat || '',
          total_csv_junio: june?.total_sunat ?? '',
          explicacion: june
            ? 'No esta en CSV mayo porque SUNAT lo muestra en CSV junio'
            : april
              ? 'No esta en CSV mayo porque aparece en CSV abril'
              : 'No aparece en CSV abril/mayo/junio revisados',
        });
      }
    }

    const sunatNotInDb = sunat.mayo
      .filter((row) => !dbMap.has(row.key))
      .map((row) => ({
        numero_completo: row.key,
        fecha_sunat: row.fecha_sunat,
        total_sunat: row.total_sunat,
        cliente_doc: row.cliente_doc,
        cliente: row.cliente,
        serie: row.serie,
      }));

    const totalDiffRows = matched.filter((row) => Math.abs(row.diferencia) >= 0.01);
    const dbNotInMayAndInJune = dbNotInMay.filter((row) => row.en_csv_junio === 'SI');
    const dbNotInAnyCsv = dbNotInMay.filter((row) => row.en_csv_abril === 'NO' && row.en_csv_junio === 'NO');
    const comparableDbNotInMay = dbNotInMay.filter((row) => comparableKeys.has(row.numero_completo));
    const comparableDbNotInMayAndInJune = comparableDbNotInMay.filter((row) => row.en_csv_junio === 'SI');
    const comparableDbNotInAnyCsv = comparableDbNotInMay.filter((row) => row.en_csv_abril === 'NO' && row.en_csv_junio === 'NO');

    const notesByAffected = new Map();
    for (const note of [...notes.mayo, ...notes.junio]) {
      const list = notesByAffected.get(note.affected) || [];
      list.push(note);
      notesByAffected.set(note.affected, list);
    }
    const dbNotInMayWithNotes = dbNotInMay.map((row) => ({
      ...row,
      notas_credito: (notesByAffected.get(row.numero_completo) || []).map((note) => `${note.nota} ${note.mes_csv} ${note.total_nota}`).join(' | '),
    }));

    fs.mkdirSync(OUT_DIR, { recursive: true });
    writeCsv(path.join(OUT_DIR, 'db_mayo_no_en_csv_mayo.csv'), dbNotInMayWithNotes);
    writeCsv(path.join(OUT_DIR, 'db_mayo_en_csv_junio.csv'), dbNotInMayWithNotes.filter((row) => row.en_csv_junio === 'SI'));
    writeCsv(path.join(OUT_DIR, 'db_mayo_no_en_abril_mayo_junio.csv'), dbNotInMayWithNotes.filter((row) => row.en_csv_abril === 'NO' && row.en_csv_junio === 'NO'));
    writeCsv(path.join(OUT_DIR, 'sunat_mayo_no_en_db_mayo.csv'), sunatNotInDb);
    writeCsv(path.join(OUT_DIR, 'matches_con_diferencia_total.csv'), totalDiffRows);

    const byDbCompany = [...groupRows(dbRows, (row) => `${row.company_id} ${row.company_name}`).entries()].map(([key, rows]) => ({
      key,
      count: rows.length,
      total: sum(rows, (row) => row.total_db),
    }));
    const byDbEstado = [...groupRows(dbRows, (row) => row.estado_sunat || 'SIN_ESTADO').entries()].map(([key, rows]) => ({
      key,
      count: rows.length,
      total: sum(rows, (row) => row.total_db),
    }));
    const bySunatSerie = [...groupRows(sunat.mayo, (row) => row.serie).entries()].map(([key, rows]) => ({
      key,
      count: rows.length,
      total: sum(rows, (row) => row.total_sunat),
    }));
    const byDbNotInMaySummary = [...groupRows(dbNotInMay, (row) => row.explicacion).entries()].map(([key, rows]) => ({
      key,
      count: rows.length,
      total: sum(rows, (row) => row.total_db),
    }));

    const dbTotal = sum(dbRows, (row) => row.total_db);
    const comparableDbTotal = sum(comparableDbRows, (row) => row.total_db);
    const sunatMayTotal = sum(sunat.mayo, (row) => row.total_sunat);
    const dbVsSunatDelta = round2(dbTotal - sunatMayTotal);
    const comparableDbVsSunatDelta = round2(comparableDbTotal - sunatMayTotal);
    const comparableExplained = round2(
      sum(comparableDbNotInMayAndInJune, (row) => row.total_db)
      + sum(comparableDbNotInAnyCsv, (row) => row.total_db)
      + sum(totalDiffRows, (row) => row.diferencia),
    );
    const explainDelta = round2(
      sum(dbNotInMay, (row) => row.total_db)
      - sum(sunatNotInDb, (row) => row.total_sunat)
      - sum(totalDiffRows, (row) => -row.diferencia),
    );

    const lines = [
      '# Reconciliacion mayo 2026 - Limbo / RUC compartido',
      '',
      `Generado: ${new Date().toISOString()}`,
      `Carpeta fuente: \`${SELLER_DIR}\``,
      `RUC: \`${RUC}\``,
      '',
      '## Archivos SUNAT usados',
      '',
      '| Mes carpeta | Archivo | Periodo detectado | Filas | Boletas 03 | Total boletas |',
      '| --- | --- | --- | ---: | ---: | ---: |',
      ...Object.entries(csvSummary).map(([month, info]) => `| ${month} | ${info.file} | ${info.periods.join(', ')} | ${info.rows} | ${info.byType['03']?.count || 0} | S/ ${money(info.byType['03']?.total || 0)} |`),
      '',
      '## Total mayo: sistema vs SUNAT',
      '',
      '| Fuente | Criterio | Cantidad boletas | Total |',
      '| --- | --- | ---: | ---: |',
      `| Sistema Postgres | Empresas con RUC ${RUC}, fecha_emision mayo 2026 | ${dbRows.length} | S/ ${money(dbTotal)} |`,
      `| SUNAT CSV MAYO | Tipo 03 en carpeta MAYO | ${sunat.mayo.length} | S/ ${money(sunatMayTotal)} |`,
      `| Diferencia sistema - SUNAT | Sistema menos CSV mayo | ${dbRows.length - sunat.mayo.length} | S/ ${money(dbVsSunatDelta)} |`,
      '',
      '## Total comparable con SUNAT / tarjeta',
      '',
      'Este es el corte que explica la tarjeta del sistema: boletas con estado `ACEPTADO` o `ANULADO`. Las `PENDIENTE` estan en DB, pero no fueron enviadas/aceptadas por SUNAT.',
      '',
      '| Fuente | Criterio | Cantidad boletas | Total |',
      '| --- | --- | ---: | ---: |',
      `| Sistema comparable | RUC ${RUC}, fecha_emision mayo 2026, estado ACEPTADO/ANULADO | ${comparableDbRows.length} | S/ ${money(comparableDbTotal)} |`,
      `| SUNAT CSV MAYO | Tipo 03 en carpeta MAYO | ${sunat.mayo.length} | S/ ${money(sunatMayTotal)} |`,
      `| Diferencia comparable | Sistema comparable menos CSV mayo | ${comparableDbRows.length - sunat.mayo.length} | S/ ${money(comparableDbVsSunatDelta)} |`,
      `| Pendientes en DB no comparables | Estado PENDIENTE | ${pendingDbRows.length} | S/ ${money(sum(pendingDbRows, (row) => row.total_db))} |`,
      '',
      '## Desglose sistema por empresa',
      '',
      '| Empresa DB | Cantidad | Total |',
      '| --- | ---: | ---: |',
      ...byDbCompany.map((row) => `| ${row.key} | ${row.count} | S/ ${money(row.total)} |`),
      '',
      '## Desglose sistema por estado',
      '',
      '| Estado DB | Cantidad | Total |',
      '| --- | ---: | ---: |',
      ...byDbEstado.map((row) => `| ${row.key} | ${row.count} | S/ ${money(row.total)} |`),
      '',
      '## Desglose SUNAT mayo por serie',
      '',
      '| Serie | Cantidad | Total |',
      '| --- | ---: | ---: |',
      ...bySunatSerie.map((row) => `| ${row.key} | ${row.count} | S/ ${money(row.total)} |`),
      '',
      '## Por que hay desfase',
      '',
      '### Desfase comparable con SUNAT / tarjeta',
      '',
      '| Causa | Cantidad | Impacto bruto |',
      '| --- | ---: | ---: |',
      `| Boletas de mayo que SUNAT muestra en CSV junio | ${comparableDbNotInMayAndInJune.length} | S/ ${money(sum(comparableDbNotInMayAndInJune, (row) => row.total_db))} |`,
      `| Boletas aceptadas en produccion pero fuera de CSV abril/mayo/junio | ${comparableDbNotInAnyCsv.length} | S/ ${money(sum(comparableDbNotInAnyCsv, (row) => row.total_db))} |`,
      `| Matches con total distinto | ${totalDiffRows.length} | S/ ${money(sum(totalDiffRows, (row) => row.diferencia))} |`,
      `| Total explicado | ${comparableDbRows.length - sunat.mayo.length} | S/ ${money(comparableExplained)} |`,
      '',
      '### Desfase bruto incluyendo pendientes',
      '',
      '| Causa | Cantidad | Impacto bruto |',
      '| --- | ---: | ---: |',
      ...byDbNotInMaySummary.map((row) => `| ${row.key} | ${row.count} | S/ ${money(row.total)} |`),
      `| SUNAT mayo que no esta en DB mayo | ${sunatNotInDb.length} | -S/ ${money(sum(sunatNotInDb, (row) => row.total_sunat))} |`,
      `| Matches con total distinto | ${totalDiffRows.length} | S/ ${money(sum(totalDiffRows, (row) => row.diferencia))} |`,
      '',
      'Nota: el impacto bruto por causa no resta notas de credito; es comparacion directa de boletas tipo 03.',
      '',
      '## Boletas del sistema mayo que no estan en CSV mayo',
      '',
      `Total: ${dbNotInMay.length} boletas, S/ ${money(sum(dbNotInMay, (row) => row.total_db))}.`,
      '',
      '| Grupo | Cantidad | Total | Archivo detalle |',
      '| --- | ---: | ---: | --- |',
      `| Aparecen en CSV junio | ${dbNotInMayAndInJune.length} | S/ ${money(sum(dbNotInMayAndInJune, (row) => row.total_db))} | db_mayo_en_csv_junio.csv |`,
      `| No aparecen en abril/mayo/junio | ${dbNotInAnyCsv.length} | S/ ${money(sum(dbNotInAnyCsv, (row) => row.total_db))} | db_mayo_no_en_abril_mayo_junio.csv |`,
      '',
      '## Boletas comparables que explican la tarjeta',
      '',
      `Total comparable no encontrado en CSV mayo: ${comparableDbNotInMay.length} boletas, S/ ${money(sum(comparableDbNotInMay, (row) => row.total_db))}.`,
      '',
      '| Grupo | Cantidad | Total |',
      '| --- | ---: | ---: |',
      `| Aparecen en CSV junio | ${comparableDbNotInMayAndInJune.length} | S/ ${money(sum(comparableDbNotInMayAndInJune, (row) => row.total_db))} |`,
      `| No aparecen en abril/mayo/junio | ${comparableDbNotInAnyCsv.length} | S/ ${money(sum(comparableDbNotInAnyCsv, (row) => row.total_db))} |`,
      '',
      '## Los que no aparecen en abril/mayo/junio',
      '',
      '| Boleta | Fecha DB | Total | Orden | Resumen | Estado |',
      '| --- | --- | ---: | --- | --- | --- |',
      ...dbNotInAnyCsv.map((row) => `| ${row.numero_completo} | ${row.fecha_db} | S/ ${money(row.total_db)} | ${row.order_number || '-'} | ${row.resumen || '-'} | ${row.estado_db || '-'} |`),
      '',
      '## Archivos generados',
      '',
      '- `db_mayo_no_en_csv_mayo.csv`: todo lo que esta en DB mayo y falta en CSV mayo.',
      '- `db_mayo_en_csv_junio.csv`: subconjunto que explica desfase porque aparece en junio.',
      '- `db_mayo_no_en_abril_mayo_junio.csv`: pendientes/inconsistencia CSV masivo.',
      '- `sunat_mayo_no_en_db_mayo.csv`: SUNAT mayo sin boleta DB en fecha mayo.',
      '- `matches_con_diferencia_total.csv`: comprobantes encontrados en ambos lados con total distinto.',
      '',
      `Control delta calculado: S/ ${money(explainDelta)} (debe aproximar diferencia sistema - SUNAT S/ ${money(dbVsSunatDelta)}).`,
    ];

    fs.writeFileSync(path.join(OUT_DIR, 'reporte_mayo_desfase_boletas.md'), `${lines.join('\n')}\n`);

    console.log(JSON.stringify({
      outDir: OUT_DIR,
      csvSummary,
      system: { count: dbRows.length, total: dbTotal },
      comparableSystem: { count: comparableDbRows.length, total: comparableDbTotal },
      pending: { count: pendingDbRows.length, total: sum(pendingDbRows, (row) => row.total_db) },
      sunatMayo: { count: sunat.mayo.length, total: sunatMayTotal },
      difference: { count: dbRows.length - sunat.mayo.length, total: dbVsSunatDelta },
      comparableDifference: { count: comparableDbRows.length - sunat.mayo.length, total: comparableDbVsSunatDelta, explained: comparableExplained },
      dbNotInMay: { count: dbNotInMay.length, total: sum(dbNotInMay, (row) => row.total_db) },
      dbNotInMayAndInJune: { count: dbNotInMayAndInJune.length, total: sum(dbNotInMayAndInJune, (row) => row.total_db) },
      dbNotInAnyCsv: { count: dbNotInAnyCsv.length, total: sum(dbNotInAnyCsv, (row) => row.total_db), docs: dbNotInAnyCsv.map((row) => row.numero_completo) },
      sunatNotInDb: { count: sunatNotInDb.length, total: sum(sunatNotInDb, (row) => row.total_sunat) },
      totalDiffRows: { count: totalDiffRows.length, totalDiff: sum(totalDiffRows, (row) => row.diferencia) },
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
