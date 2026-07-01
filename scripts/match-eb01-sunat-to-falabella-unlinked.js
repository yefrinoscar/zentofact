const fs = require('fs');
const path = require('path');

const OUT_DIR = path.resolve('reports/mayo-2026-boletas-claro');
const FALABELLA_FLOW = path.join(OUT_DIR, 'origen_dinero_falabella_mayo_a_sunat.csv');
const SUNAT_FLOW = path.join(OUT_DIR, 'origen_dinero_sunat_mayo_a_falabella.csv');
const FALABELLA_ALL = path.join(OUT_DIR, 'falabella_mayo_boletas_limbo_higher.csv');
const CROSS_COMPANY_MATCHES = path.join(OUT_DIR, 'sunat_mayo_69_no_falabella_mayo_con_origen.csv');

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

function dateOnly(value) {
  return String(value || '').slice(0, 10);
}

function parseSunatDate(value) {
  const [dd, mm, yyyy] = String(value || '').split('/');
  if (!yyyy) return '';
  return `${yyyy}-${mm}-${dd}`;
}

function dayDistance(a, b) {
  if (!a || !b) return 9999;
  const da = new Date(`${a}T00:00:00Z`);
  const db = new Date(`${b}T00:00:00Z`);
  return Math.abs(Math.round((da - db) / 86400000));
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

function groupByAmount(rows, amountKey) {
  const map = new Map();
  for (const row of rows) {
    const key = money(row[amountKey]);
    const arr = map.get(key) || [];
    arr.push(row);
    map.set(key, arr);
  }
  return map;
}

function main() {
  const falabellaFlow = readCsv(FALABELLA_FLOW);
  const sunatFlow = readCsv(SUNAT_FLOW);
  const falabellaAll = readCsv(FALABELLA_ALL);
  const crossCompanyRows = fs.existsSync(CROSS_COMPANY_MATCHES) ? readCsv(CROSS_COMPANY_MATCHES) : [];
  const crossCompanyOrderNumbers = new Set(
    crossCompanyRows
      .filter((row) => row.orderNumber && row.falabellaPrice)
      .map((row) => row.orderNumber),
  );
  const falabellaAllByOrder = new Map(falabellaAll.map((row) => [row.orderNumber, row]));

  const falabellaUnlinked = falabellaFlow
    .filter((row) => row.grupo === 'Falabella mayo boleta sin boleta en DB')
    .filter((row) => !crossCompanyOrderNumbers.has(row.orderNumber))
    .map((row) => {
      const full = falabellaAllByOrder.get(row.orderNumber) || {};
      return {
        ...row,
        falabellaPrice: amount(row.falabellaPrice),
        createdAt: full.createdAt || '',
        updatedAt: full.updatedAt || '',
        status: full.status || '',
        orderId: full.orderId || '',
      };
    });

  const sunatUnlinked = sunatFlow
    .filter((row) => row.grupo === 'SUNAT mayo sin orderNumber en DB')
    .map((row) => ({
      ...row,
      sunatTotal: amount(row.sunatTotal),
      sunatIsoDate: parseSunatDate(row.sunatFecha),
    }));

  const falabellaByAmount = groupByAmount(falabellaUnlinked, 'falabellaPrice');
  const sunatByAmount = groupByAmount(sunatUnlinked, 'sunatTotal');

  const amountGroups = [];
  for (const amountKey of new Set([...falabellaByAmount.keys(), ...sunatByAmount.keys()])) {
    const f = falabellaByAmount.get(amountKey) || [];
    const s = sunatByAmount.get(amountKey) || [];
    amountGroups.push({
      amount: amountKey,
      falabellaCount: f.length,
      falabellaTotal: amount(f.reduce((sum, row) => sum + row.falabellaPrice, 0)),
      sunatCount: s.length,
      sunatTotal: amount(s.reduce((sum, row) => sum + row.sunatTotal, 0)),
      deltaCount: s.length - f.length,
      deltaTotal: amount(s.reduce((sum, row) => sum + row.sunatTotal, 0) - f.reduce((sum, row) => sum + row.falabellaPrice, 0)),
    });
  }
  amountGroups.sort((a, b) => Math.abs(b.deltaTotal) - Math.abs(a.deltaTotal) || Number(b.amount.replace(/,/g, '')) - Number(a.amount.replace(/,/g, '')));

  const matches = [];
  const usedFalabella = new Set();
  const usedSunat = new Set();

  // Pass 1: one-to-one exact amount groups.
  for (const [amountKey, sRows] of sunatByAmount.entries()) {
    const fRows = falabellaByAmount.get(amountKey) || [];
    if (sRows.length === 1 && fRows.length === 1) {
      const s = sRows[0];
      const f = fRows[0];
      matches.push({
        matchType: 'exacto_unico_por_monto',
        confidence: 'alta',
        boletaSunat: s.boleta,
        sunatFecha: s.sunatFecha,
        sunatTotal: s.sunatTotal,
        orderNumber: f.orderNumber,
        orderId: f.orderId,
        falabellaCreatedAt: f.createdAt,
        falabellaUpdatedAt: f.updatedAt,
        falabellaTotal: f.falabellaPrice,
        seller: f.seller,
        dayDistance: dayDistance(s.sunatIsoDate, dateOnly(f.createdAt)),
        status: f.status,
      });
      usedSunat.add(s.boleta);
      usedFalabella.add(f.orderNumber);
    }
  }

  // Pass 2: for duplicated amounts, greedily match nearest dates.
  for (const [amountKey, sRowsRaw] of sunatByAmount.entries()) {
    const fRowsRaw = falabellaByAmount.get(amountKey) || [];
    const sRows = sRowsRaw.filter((row) => !usedSunat.has(row.boleta));
    const fRows = fRowsRaw.filter((row) => !usedFalabella.has(row.orderNumber));
    if (!sRows.length || !fRows.length) continue;
    const candidates = [];
    for (const s of sRows) {
      for (const f of fRows) {
        candidates.push({ s, f, distance: dayDistance(s.sunatIsoDate, dateOnly(f.createdAt)) });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance || String(a.s.boleta).localeCompare(String(b.s.boleta)));
    for (const candidate of candidates) {
      if (usedSunat.has(candidate.s.boleta) || usedFalabella.has(candidate.f.orderNumber)) continue;
      usedSunat.add(candidate.s.boleta);
      usedFalabella.add(candidate.f.orderNumber);
      const duplicateCount = Math.max(sRowsRaw.length, fRowsRaw.length);
      matches.push({
        matchType: 'monto_duplicado_fecha_mas_cercana',
        confidence: candidate.distance <= 3 ? 'media' : 'baja',
        boletaSunat: candidate.s.boleta,
        sunatFecha: candidate.s.sunatFecha,
        sunatTotal: candidate.s.sunatTotal,
        orderNumber: candidate.f.orderNumber,
        orderId: candidate.f.orderId,
        falabellaCreatedAt: candidate.f.createdAt,
        falabellaUpdatedAt: candidate.f.updatedAt,
        falabellaTotal: candidate.f.falabellaPrice,
        seller: candidate.f.seller,
        dayDistance: candidate.distance,
        status: candidate.f.status,
        duplicateAmountPool: duplicateCount,
      });
    }
  }

  const unmatchedSunat = sunatUnlinked
    .filter((row) => !usedSunat.has(row.boleta))
    .map((row) => ({
      boletaSunat: row.boleta,
      sunatFecha: row.sunatFecha,
      sunatTotal: row.sunatTotal,
      reason: (falabellaByAmount.get(money(row.sunatTotal)) || []).length ? 'monto existe en Falabella pero ya fue asignado' : 'no hay monto equivalente en Falabella sin enlace',
    }));

  const unmatchedFalabella = falabellaUnlinked
    .filter((row) => !usedFalabella.has(row.orderNumber))
    .map((row) => ({
      orderNumber: row.orderNumber,
      orderId: row.orderId,
      falabellaCreatedAt: row.createdAt,
      falabellaTotal: row.falabellaPrice,
      seller: row.seller,
      status: row.status,
      reason: (sunatByAmount.get(money(row.falabellaPrice)) || []).length ? 'monto existe en SUNAT pero ya fue asignado' : 'no hay monto equivalente en SUNAT sin orderNumber',
    }));

  const summary = [
    { metric: 'SUNAT mayo sin orderNumber', count: sunatUnlinked.length, total: amount(sunatUnlinked.reduce((sum, row) => sum + row.sunatTotal, 0)) },
    { metric: 'Falabella mayo reclasificado por orderNumber cruzado Limbo/Higher', count: crossCompanyOrderNumbers.size, total: amount(crossCompanyRows.filter((row) => crossCompanyOrderNumbers.has(row.orderNumber)).reduce((sum, row) => sum + amount(row.falabellaPrice), 0)) },
    { metric: 'Falabella mayo sin boleta enlazada', count: falabellaUnlinked.length, total: amount(falabellaUnlinked.reduce((sum, row) => sum + row.falabellaPrice, 0)) },
    { metric: 'Equivalencias propuestas', count: matches.length, total: amount(matches.reduce((sum, row) => sum + Number(row.sunatTotal || 0), 0)) },
    { metric: 'SUNAT no emparejado', count: unmatchedSunat.length, total: amount(unmatchedSunat.reduce((sum, row) => sum + row.sunatTotal, 0)) },
    { metric: 'Falabella no emparejado', count: unmatchedFalabella.length, total: amount(unmatchedFalabella.reduce((sum, row) => sum + row.falabellaTotal, 0)) },
  ];

  writeCsv(path.join(OUT_DIR, 'equivalencias_eb01_falabella_mayo.csv'), matches);
  writeCsv(path.join(OUT_DIR, 'equivalencias_eb01_sunat_no_emparejado.csv'), unmatchedSunat);
  writeCsv(path.join(OUT_DIR, 'equivalencias_eb01_falabella_no_emparejado.csv'), unmatchedFalabella);
  writeCsv(path.join(OUT_DIR, 'equivalencias_eb01_grupos_por_monto.csv'), amountGroups);
  writeCsv(path.join(OUT_DIR, 'equivalencias_eb01_resumen.csv'), summary);

  const high = matches.filter((row) => row.confidence === 'alta');
  const medium = matches.filter((row) => row.confidence === 'media');
  const low = matches.filter((row) => row.confidence === 'baja');
  const sunatUnlinkedSummary = summary.find((row) => row.metric === 'SUNAT mayo sin orderNumber');
  const falabellaUnlinkedSummary = summary.find((row) => row.metric === 'Falabella mayo sin boleta enlazada');
  const lines = [
    '# Equivalencias 1x1 - SUNAT EB01 mayo vs Falabella mayo sin enlace',
    '',
    `Generado: ${new Date().toISOString()}`,
    '',
    'Criterio usado: monto exacto. Cuando el monto es unico en ambos lados, la equivalencia es alta. Cuando el monto se repite, se asigna por fecha mas cercana y queda como media/baja segun distancia.',
    '',
    '| Resultado | Cantidad | Total |',
    '| --- | ---: | ---: |',
    ...summary.map((row) => `| ${row.metric} | ${row.count} | S/ ${money(row.total)} |`),
    '',
    '## Calidad de equivalencias',
    '',
    '| Confianza | Cantidad | Total |',
    '| --- | ---: | ---: |',
    `| Alta: monto unico | ${high.length} | S/ ${money(high.reduce((sum, row) => sum + Number(row.sunatTotal || 0), 0))} |`,
    `| Media: monto repetido, fecha cercana | ${medium.length} | S/ ${money(medium.reduce((sum, row) => sum + Number(row.sunatTotal || 0), 0))} |`,
    `| Baja: monto repetido, fecha lejana | ${low.length} | S/ ${money(low.reduce((sum, row) => sum + Number(row.sunatTotal || 0), 0))} |`,
    '',
    '## Diferencia residual',
    '',
    `SUNAT EB01 sin orderNumber suma S/ ${money(sunatUnlinkedSummary.total)}; Falabella sin enlace suma S/ ${money(falabellaUnlinkedSummary.total)}. Diferencia: S/ ${money(sunatUnlinkedSummary.total - falabellaUnlinkedSummary.total)}.`,
    '',
    'Archivos:',
    '- `equivalencias_eb01_falabella_mayo.csv`',
    '- `equivalencias_eb01_sunat_no_emparejado.csv`',
    '- `equivalencias_eb01_falabella_no_emparejado.csv`',
    '- `equivalencias_eb01_grupos_por_monto.csv`',
    '- `equivalencias_eb01_resumen.csv`',
  ];
  fs.writeFileSync(path.join(OUT_DIR, 'equivalencias_eb01_falabella_mayo.md'), `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
}

main();
