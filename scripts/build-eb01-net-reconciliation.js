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

function group(rows, predicate, amountKey) {
  const selected = rows.filter(predicate);
  return { count: selected.length, total: sum(selected, amountKey) };
}

function csvEscape(value) {
  const str = String(value ?? '');
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function writeCsv(file, rows) {
  const columns = Object.keys(rows[0] || { empty: '' });
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((column) => csvEscape(row[column])).join(','));
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

function mdTable(rows) {
  return [
    '| Bloque | Cantidad | Total | Lectura |',
    '| --- | ---: | ---: | --- |',
    ...rows.map((row) => `| ${row.bloque} | ${row.cantidad} | ${row.totalLabel || `S/ ${money(row.total)}`} | ${row.lectura} |`),
  ];
}

function main() {
  const falabella = readCsv(path.join(OUT_DIR, 'equivalencias_mayo_falabella_1x1.csv'));
  const sunat = readCsv(path.join(OUT_DIR, 'equivalencias_mayo_sunat_1x1.csv'));

  const falabellaUnlinked = group(
    falabella,
    (row) => row.verificacion === 'sin_equivalencia_sunat_mayo',
    'falabellaTotal',
  );
  const falabellaEb01Inferred = group(
    falabella,
    (row) => row.verificacion === 'inferida_monto_fecha_eb01',
    'falabellaTotal',
  );
  const sunatEb01Unmatched = group(
    sunat,
    (row) => row.verificacion === 'sin_equivalencia_falabella_mayo',
    'sunatTotal',
  );
  const sunatEb01Inferred = group(
    sunat,
    (row) => row.verificacion === 'inferida_monto_fecha_falabella',
    'sunatTotal',
  );
  const sunatDirect = group(
    sunat,
    (row) => row.verificacion.startsWith('directa_orderNumber'),
    'sunatTotal',
  );
  const falabellaDirect = group(
    falabella,
    (row) => row.verificacion.startsWith('directa_orderNumber') && row.sunatMes === 'mayo',
    'falabellaTotal',
  );
  const falabellaJune = group(
    falabella,
    (row) => row.verificacion === 'directa_orderNumber_db_csv_sunat_junio',
    'falabellaTotal',
  );
  const falabellaDbNoCsv = group(
    falabella,
    (row) => row.verificacion === 'directa_orderNumber_db_sin_csv_abr_may_jun',
    'falabellaTotal',
  );

  const eb01Total = {
    count: sunatEb01Inferred.count + sunatEb01Unmatched.count,
    total: amount(sunatEb01Inferred.total + sunatEb01Unmatched.total),
  };
  const falabellaNeedsEb01 = {
    count: falabellaEb01Inferred.count + falabellaUnlinked.count,
    total: amount(falabellaEb01Inferred.total + falabellaUnlinked.total),
  };
  const compensated = {
    count: Math.min(eb01Total.count, falabellaNeedsEb01.count),
    total: amount(Math.min(eb01Total.total, falabellaNeedsEb01.total)),
  };
  const sunatResidual = amount(eb01Total.total - falabellaNeedsEb01.total);

  const rows = [
    {
      bloque: 'Directo por orderNumber',
      cantidad: `${falabellaDirect.count} Falabella / ${sunatDirect.count} SUNAT`,
      total: 0,
      totalLabel: `S/ ${money(falabellaDirect.total)} Falabella / S/ ${money(sunatDirect.total)} SUNAT`,
      lectura: 'Comprobado por orden en mayo; incluye Limbo/Higher cruzado por mismo RUC.',
    },
    {
      bloque: 'Falabella mayo enviada a SUNAT junio',
      cantidad: falabellaJune.count,
      total: falabellaJune.total,
      lectura: 'Venta Falabella de mayo, pero fiscalmente cae en junio.',
    },
    {
      bloque: 'Falabella en DB sin CSV abril/mayo/junio',
      cantidad: falabellaDbNoCsv.count,
      total: falabellaDbNoCsv.total,
      lectura: 'Existe en nuestra DB, pero no esta ubicada en los CSV SUNAT revisados.',
    },
    {
      bloque: 'Bolsa EB01 SUNAT',
      cantidad: eb01Total.count,
      total: eb01Total.total,
      lectura: 'Boletas SUNAT/DB sin orderNumber; no se puede saber la orden exacta.',
    },
    {
      bloque: 'Falabella que necesita compensarse con EB01',
      cantidad: falabellaNeedsEb01.count,
      total: falabellaNeedsEb01.total,
      lectura: 'Ventas Falabella mayo que no tienen boleta directa por orderNumber.',
    },
    {
      bloque: 'Compensado por EB01',
      cantidad: compensated.count,
      total: compensated.total,
      lectura: 'Esto no debe contarse como diferencia real; EB01 cubre este bloque en agregado.',
    },
    {
      bloque: 'Residuo despues de compensar EB01',
      cantidad: '',
      total: sunatResidual,
      lectura: sunatResidual > 0
        ? 'Sobra SUNAT/DB sobre Falabella: revisar origen de estas EB01.'
        : 'Sobra Falabella sobre SUNAT/DB: revisar ventas Falabella sin boleta.',
    },
  ];

  writeCsv(path.join(OUT_DIR, 'reconciliacion_neta_eb01_vs_falabella.csv'), rows);

  const lines = [
    '# Reconciliacion neta EB01 vs Falabella - Mayo 2026',
    '',
    `Generado: ${new Date().toISOString()}`,
    '',
    '## Criterio',
    '',
    'Las EB01 no tienen `orderNumber`, asi que no se deben comparar como boletas identificables una por una. Contablemente se usan como una bolsa que compensa ventas Falabella sin boleta directa por `orderNumber`.',
    '',
    ...mdTable(rows),
    '',
    '## Conclusion',
    '',
    `Falabella que necesita compensacion EB01 suma S/ ${money(falabellaNeedsEb01.total)}. La bolsa EB01 SUNAT suma S/ ${money(eb01Total.total)}. Despues de compensar, queda un residuo SUNAT de S/ ${money(sunatResidual)}.`,
    '',
    'Los archivos 1x1 siguen sirviendo para revisar fila por fila, pero la lectura contable correcta es netear primero la bolsa EB01 contra Falabella sin enlace directo.',
  ];

  fs.writeFileSync(path.join(OUT_DIR, 'reconciliacion_neta_eb01_vs_falabella.md'), `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
}

main();
