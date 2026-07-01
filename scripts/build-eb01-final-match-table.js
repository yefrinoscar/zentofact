const fs = require('fs');
const path = require('path');

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
  if (!text) return [];
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

function money(value) {
  return amount(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sum(rows, key) {
  return amount(rows.reduce((total, row) => total + amount(row[key]), 0));
}

function group(rows, key) {
  const result = new Map();
  for (const row of rows) {
    const groupKey = row[key] || 'sin dato';
    const current = result.get(groupKey) || { label: groupKey, count: 0, total: 0 };
    current.count += 1;
    current.total = amount(current.total + amount(row.sunatTotal));
    result.set(groupKey, current);
  }
  return Array.from(result.values());
}

function main() {
  const matches = readCsv(path.join(OUT_DIR, 'eb01_falabella_api_matches.csv'));
  const unmatched = readCsv(path.join(OUT_DIR, 'eb01_falabella_api_sunat_no_match.csv'));

  const byConfidence = group(matches, 'confidence');
  const bySeller = group(matches, 'seller');
  const unmatchedNotes = unmatched.map((row) => {
    let note = 'No encontre orden Falabella abril-junio con mismo documento y monto.';
    if (row.boletaSunat === 'EB01-006046') {
      note = 'Duplicada exacta de EB01-006045: mismo DNI, cliente y monto; Falabella tiene una sola orden 3233248197, ya asignada a EB01-006045.';
    }
    return { ...row, note };
  });

  const lines = [
    '# Cuadre EB01 con Falabella API',
    '',
    `Generado: ${new Date().toISOString()}`,
    '',
    '## Resumen',
    '',
    '| Concepto | Cantidad | Total |',
    '| --- | ---: | ---: |',
    `| EB01 SUNAT mayo | ${matches.length + unmatched.length} | S/ ${money(sum(matches, 'sunatTotal') + sum(unmatched, 'sunatTotal'))} |`,
    `| EB01 cuadradas con Falabella API | ${matches.length} | S/ ${money(sum(matches, 'sunatTotal'))} |`,
    `| EB01 sin cuadrar | ${unmatched.length} | S/ ${money(sum(unmatched, 'sunatTotal'))} |`,
    '',
    '## Calidad del cruce',
    '',
    '| Confianza | Cantidad | Total |',
    '| --- | ---: | ---: |',
    ...byConfidence.map((row) => `| ${row.label} | ${row.count} | S/ ${money(row.total)} |`),
    '',
    '## Interno Limbo/Higher segun Falabella',
    '',
    '| Seller Falabella | EB01 cuadradas | Total |',
    '| --- | ---: | ---: |',
    ...bySeller.map((row) => `| ${row.label} | ${row.count} | S/ ${money(row.total)} |`),
    '',
    '## No cuadradas',
    '',
    '| EB01 | Fecha | Total | DNI | Cliente | Nota |',
    '| --- | --- | ---: | --- | --- | --- |',
    ...unmatchedNotes.map((row) => `| ${row.boletaSunat} | ${row.sunatFecha} | S/ ${money(row.sunatTotal)} | ${row.sunatDoc} | ${row.sunatName} | ${row.note} |`),
    '',
    '## Archivos detalle',
    '',
    '- `eb01_falabella_api_matches.csv`',
    '- `eb01_falabella_api_sunat_no_match.csv`',
    '- `falabella_abr_jun_boletas_con_cliente.csv`',
  ];

  fs.writeFileSync(path.join(OUT_DIR, 'eb01_falabella_api_cuadre_final.md'), `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
}

main();
