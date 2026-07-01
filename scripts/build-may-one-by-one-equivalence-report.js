const fs = require('fs');
const path = require('path');

const OUT_DIR = path.resolve('reports/mayo-2026-boletas-claro');

const files = {
  falabellaFlow: path.join(OUT_DIR, 'origen_dinero_falabella_mayo_a_sunat.csv'),
  sunatFlow: path.join(OUT_DIR, 'origen_dinero_sunat_mayo_a_falabella.csv'),
  inferredMatches: path.join(OUT_DIR, 'equivalencias_eb01_falabella_mayo.csv'),
  unmatchedSunat: path.join(OUT_DIR, 'equivalencias_eb01_sunat_no_emparejado.csv'),
  unmatchedFalabella: path.join(OUT_DIR, 'equivalencias_eb01_falabella_no_emparejado.csv'),
  crossCompanyMatches: path.join(OUT_DIR, 'sunat_mayo_69_no_falabella_mayo_con_origen.csv'),
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
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    let values = parseCsvLine(line);
    if (values.length === headers.length + 1 && headers[0] === 'grupo' && headers[1] === 'boleta') {
      values = [`${values[0]},${values[1]}`, ...values.slice(2)];
    }
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

function addGroup(map, key, count = 1, total = 0) {
  const current = map.get(key) || { grupo: key, cantidad: 0, total: 0 };
  current.cantidad += count;
  current.total = amount(current.total + amount(total));
  map.set(key, current);
}

function mdTable(rows, columns) {
  return [
    `| ${columns.map((col) => col.label).join(' | ')} |`,
    `| ${columns.map((col) => col.align || '---').join(' | ')} |`,
    ...rows.map((row) => `| ${columns.map((col) => row[col.key] ?? '').join(' | ')} |`),
  ];
}

function main() {
  const falabellaFlow = readCsv(files.falabellaFlow);
  const sunatFlow = readCsv(files.sunatFlow);
  const inferredMatches = readCsv(files.inferredMatches);
  const unmatchedSunat = readCsv(files.unmatchedSunat);
  const unmatchedFalabella = readCsv(files.unmatchedFalabella);
  const crossCompanyRows = fs.existsSync(files.crossCompanyMatches) ? readCsv(files.crossCompanyMatches) : [];

  const inferredByOrder = new Map(inferredMatches.map((row) => [row.orderNumber, row]));
  const inferredByBoleta = new Map(inferredMatches.map((row) => [row.boletaSunat, row]));
  const unmatchedSunatByBoleta = new Map(unmatchedSunat.map((row) => [row.boletaSunat, row]));
  const unmatchedFalabellaByOrder = new Map(unmatchedFalabella.map((row) => [row.orderNumber, row]));
  const crossCompanyByOrder = new Map(
    crossCompanyRows
      .filter((row) => row.orderNumber && row.falabellaPrice)
      .map((row) => [row.orderNumber, row]),
  );
  const crossCompanyByBoleta = new Map(
    crossCompanyRows
      .filter((row) => row.boleta && row.falabellaPrice)
      .map((row) => [row.boleta, row]),
  );

  const falabellaOneByOne = falabellaFlow.map((row) => {
    const crossCompany = crossCompanyByOrder.get(row.orderNumber);
    const inferred = inferredByOrder.get(row.orderNumber);
    const unmatched = unmatchedFalabellaByOrder.get(row.orderNumber);
    if (row.boleta) {
      const sunatLabel = row.sunatMes ? `directa_orderNumber_db_csv_sunat_${row.sunatMes}` : 'directa_orderNumber_db_sin_csv_abr_may_jun';
      return {
        origen: 'Falabella mayo boleta',
        verificacion: sunatLabel,
        confianza: row.sunatMes ? 'comprobada' : 'db_sin_csv',
        company: row.company,
        seller: row.seller,
        orderNumber: row.orderNumber,
        falabellaTotal: row.falabellaPrice,
        boletaSunat: row.boleta,
        sunatMes: row.sunatMes,
        sunatTotal: row.sunatTotal,
        dbEstado: row.dbEstado,
        dbTotal: row.dbTotal,
        resumen: row.resumen,
        observacion: row.grupo,
      };
    }
    if (crossCompany) {
      return {
        origen: 'Falabella mayo boleta',
        verificacion: 'directa_orderNumber_cruzado_limbo_higher_sunat_mayo',
        confianza: 'comprobada_mismo_ruc_otro_seller',
        company: row.company,
        seller: row.seller,
        orderNumber: row.orderNumber,
        falabellaTotal: row.falabellaPrice,
        boletaSunat: crossCompany.boleta,
        sunatMes: 'mayo',
        sunatTotal: crossCompany.sunatTotal,
        dbEstado: crossCompany.dbEstado,
        dbTotal: crossCompany.dbTotal,
        resumen: crossCompany.resumen,
        observacion: `orderNumber en SUNAT/DB bajo ${crossCompany.dbCompany}; Falabella seller ${crossCompany.falabellaSeller}`,
      };
    }
    if (inferred) {
      return {
        origen: 'Falabella mayo boleta',
        verificacion: 'inferida_monto_fecha_eb01',
        confianza: inferred.confidence,
        company: row.company,
        seller: row.seller,
        orderNumber: row.orderNumber,
        falabellaTotal: row.falabellaPrice,
        boletaSunat: inferred.boletaSunat,
        sunatMes: 'mayo',
        sunatTotal: inferred.sunatTotal,
        dbEstado: '',
        dbTotal: '',
        resumen: '',
        observacion: `${inferred.matchType}; distancia_dias=${inferred.dayDistance}`,
      };
    }
    return {
      origen: 'Falabella mayo boleta',
      verificacion: 'sin_equivalencia_sunat_mayo',
      confianza: 'no_encontrada',
      company: row.company,
      seller: row.seller,
      orderNumber: row.orderNumber,
      falabellaTotal: row.falabellaPrice,
      boletaSunat: '',
      sunatMes: '',
      sunatTotal: '',
      dbEstado: '',
      dbTotal: '',
      resumen: '',
      observacion: unmatched?.reason || row.grupo,
    };
  });

  const sunatOneByOne = sunatFlow.map((row) => {
    const crossCompany = crossCompanyByBoleta.get(row.boleta);
    const inferred = inferredByBoleta.get(row.boleta);
    const unmatched = unmatchedSunatByBoleta.get(row.boleta);
    if (row.orderNumber) {
      if (!row.falabellaTotal && crossCompany) {
        return {
          origen: 'SUNAT mayo CSV',
          verificacion: 'directa_orderNumber_cruzado_limbo_higher_falabella',
          confianza: 'comprobada_mismo_ruc_otro_seller',
          boletaSunat: row.boleta,
          sunatFecha: row.sunatFecha,
          sunatTotal: row.sunatTotal,
          company: row.dbCompany,
          orderNumber: row.orderNumber,
          falabellaTipo: crossCompany.falabellaType,
          falabellaTotal: crossCompany.falabellaPrice,
          falabellaCreatedAt: crossCompany.falabellaCreatedAt,
          dbEstado: row.dbEstado,
          dbTotal: row.dbTotal,
          resumen: row.resumen,
          observacion: `orderNumber existe en Falabella seller ${crossCompany.falabellaSeller}`,
        };
      }
      return {
        origen: 'SUNAT mayo CSV',
        verificacion: row.falabellaTotal ? 'directa_orderNumber_db_falabella_mayo' : 'directa_orderNumber_db_sin_falabella_mayo',
        confianza: row.falabellaTotal ? 'comprobada' : 'db_orderNumber_no_falabella_mayo',
        boletaSunat: row.boleta,
        sunatFecha: row.sunatFecha,
        sunatTotal: row.sunatTotal,
        company: row.dbCompany,
        orderNumber: row.orderNumber,
        falabellaTipo: row.falabellaTipo,
        falabellaTotal: row.falabellaTotal,
        falabellaCreatedAt: row.falabellaCreatedAt,
        dbEstado: row.dbEstado,
        dbTotal: row.dbTotal,
        resumen: row.resumen,
        observacion: row.grupo,
      };
    }
    if (inferred) {
      return {
        origen: 'SUNAT mayo CSV',
        verificacion: 'inferida_monto_fecha_falabella',
        confianza: inferred.confidence,
        boletaSunat: row.boleta,
        sunatFecha: row.sunatFecha,
        sunatTotal: row.sunatTotal,
        company: row.dbCompany,
        orderNumber: inferred.orderNumber,
        falabellaTipo: 'boleta',
        falabellaTotal: inferred.falabellaTotal,
        falabellaCreatedAt: inferred.falabellaCreatedAt,
        dbEstado: row.dbEstado,
        dbTotal: row.dbTotal,
        resumen: row.resumen,
        observacion: `${inferred.matchType}; distancia_dias=${inferred.dayDistance}`,
      };
    }
    return {
      origen: 'SUNAT mayo CSV',
      verificacion: 'sin_equivalencia_falabella_mayo',
      confianza: 'no_encontrada',
      boletaSunat: row.boleta,
      sunatFecha: row.sunatFecha,
      sunatTotal: row.sunatTotal,
      company: row.dbCompany,
      orderNumber: '',
      falabellaTipo: '',
      falabellaTotal: '',
      falabellaCreatedAt: '',
      dbEstado: row.dbEstado,
      dbTotal: row.dbTotal,
      resumen: row.resumen,
      observacion: unmatched?.reason || row.grupo,
    };
  });

  writeCsv(path.join(OUT_DIR, 'equivalencias_mayo_falabella_1x1.csv'), falabellaOneByOne);
  writeCsv(path.join(OUT_DIR, 'equivalencias_mayo_sunat_1x1.csv'), sunatOneByOne);

  const falabellaGroups = new Map();
  for (const row of falabellaOneByOne) {
    addGroup(falabellaGroups, `${row.verificacion} / ${row.confianza}`, 1, row.falabellaTotal);
  }
  const sunatGroups = new Map();
  for (const row of sunatOneByOne) {
    addGroup(sunatGroups, `${row.verificacion} / ${row.confianza}`, 1, row.sunatTotal);
  }

  const falabellaSummary = Array.from(falabellaGroups.values()).sort((a, b) => b.total - a.total);
  const sunatSummary = Array.from(sunatGroups.values()).sort((a, b) => b.total - a.total);
  writeCsv(path.join(OUT_DIR, 'equivalencias_mayo_falabella_1x1_resumen.csv'), falabellaSummary);
  writeCsv(path.join(OUT_DIR, 'equivalencias_mayo_sunat_1x1_resumen.csv'), sunatSummary);

  const lines = [
    '# Equivalencias 1x1 - Mayo 2026',
    '',
    `Generado: ${new Date().toISOString()}`,
    '',
    '## Lectura corta',
    '',
    'Este reporte separa coincidencias comprobadas de equivalencias inferidas. Las comprobadas usan `orderNumber` en la DB; las inferidas usan monto exacto y cercania de fecha porque las boletas EB01 no tienen `orderNumber` en la DB.',
    '',
    '## Desde Falabella mayo con boleta',
    '',
    ...mdTable(falabellaSummary.map((row) => ({
      grupo: row.grupo,
      cantidad: row.cantidad,
      total: `S/ ${money(row.total)}`,
    })), [
      { key: 'grupo', label: 'Grupo' },
      { key: 'cantidad', label: 'Cantidad', align: '---:' },
      { key: 'total', label: 'Total Falabella', align: '---:' },
    ]),
    '',
    `Total Falabella revisado: ${falabellaOneByOne.length} boletas, S/ ${money(sum(falabellaOneByOne, 'falabellaTotal'))}.`,
    '',
    '## Desde SUNAT mayo CSV',
    '',
    ...mdTable(sunatSummary.map((row) => ({
      grupo: row.grupo,
      cantidad: row.cantidad,
      total: `S/ ${money(row.total)}`,
    })), [
      { key: 'grupo', label: 'Grupo' },
      { key: 'cantidad', label: 'Cantidad', align: '---:' },
      { key: 'total', label: 'Total SUNAT', align: '---:' },
    ]),
    '',
    `Total SUNAT revisado: ${sunatOneByOne.length} boletas, S/ ${money(sum(sunatOneByOne, 'sunatTotal'))}.`,
    '',
    '## Archivos',
    '',
    '- `equivalencias_mayo_falabella_1x1.csv`: cada orden Falabella mayo con boleta y su destino en DB/SUNAT o equivalencia EB01.',
    '- `equivalencias_mayo_sunat_1x1.csv`: cada boleta SUNAT mayo y su origen en DB/Falabella o equivalencia inferida.',
    '- `equivalencias_eb01_falabella_mayo.csv`: solo las equivalencias inferidas EB01 por monto/fecha.',
    '- `equivalencias_eb01_sunat_no_emparejado.csv`: EB01 SUNAT sin equivalencia Falabella.',
    '- `equivalencias_eb01_falabella_no_emparejado.csv`: Falabella mayo sin equivalencia SUNAT.',
  ];
  fs.writeFileSync(path.join(OUT_DIR, 'equivalencias_mayo_1x1.md'), `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
}

main();
