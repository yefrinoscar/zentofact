#!/usr/bin/env node

const { execFileSync } = require('child_process');
const { mkdirSync, writeFileSync } = require('fs');
const { join, resolve } = require('path');

const DEFAULT_DB_PATH = resolve(process.cwd(), 'packages/desktop/storage/boletas.db');
const OUTPUT_ROOT = resolve(process.cwd(), 'scripts/output');

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = resolve(process.cwd(), args.db || DEFAULT_DB_PATH);
  const timestamp = formatTimestamp(new Date());
  const outDir = resolve(process.cwd(), args.out || join(OUTPUT_ROOT, `falabella-igv-audit-${timestamp}`));

  const rows = queryBoletas(dbPath);
  const affected = rows
    .map(buildAuditRow)
    .filter((row) => row && row.isAffected);

  mkdirSync(outDir, { recursive: true });

  const summaryRows = buildSummaryRows(affected);
  writeCsv(join(outDir, 'summary-by-company.csv'), summaryRows);
  writeCsv(join(outDir, 'affected-boletas.csv'), affected.map(stripInternalFields));

  for (const [companyName, companyRows] of groupBy(affected, 'companyName')) {
    const filename = `affected-${slugify(companyName)}.csv`;
    writeCsv(join(outDir, filename), companyRows.map(stripInternalFields));
  }

  const report = [
    `DB: ${dbPath}`,
    `Output: ${outDir}`,
    `Affected boletas: ${affected.length}`,
    ...summaryRows.map((row) => `${row.company_name}: ${row.affected_count} boletas, diferencia total ${row.delta_total_sum}`),
  ].join('\n');

  console.log(report);
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--db' && argv[i + 1]) result.db = argv[++i];
    else if (token === '--out' && argv[i + 1]) result.out = argv[++i];
  }
  return result;
}

function queryBoletas(dbPath) {
  const sql = `
    select
      b.id,
      c.razon_social as companyName,
      c.ruc as companyRuc,
      b.numero_completo as numeroCompleto,
      b.order_number as orderNumber,
      b.fecha_emision as fechaEmision,
      b.estado_sunat as estadoSunat,
      b.mto_oper_gravadas as mtoOperGravadas,
      b.mto_igv as mtoIgv,
      b.mto_imp_venta as mtoImpVenta,
      b.detalles as detalles,
      ds.numero_completo as summaryNumero,
      ds.estado as summaryEstado
    from boletas b
    join companies c on c.id = b.company_id
    left join daily_summaries ds on ds.id = b.daily_summary_id
    where b.order_number is not null
      and b.detalles is not null
      and json_array_length(b.detalles) > 0
    order by c.razon_social, b.fecha_emision, b.numero_completo
  `;

  const raw = execFileSync('sqlite3', ['-json', dbPath, sql], { encoding: 'utf8' });
  return JSON.parse(raw);
}

function buildAuditRow(row) {
  const details = safeJsonParse(row.detalles);
  if (!Array.isArray(details) || details.length === 0) return null;

  const firstCode = readField(details[0], ['codigo']);
  const looksItemized = firstCode && firstCode !== row.orderNumber;
  if (!looksItemized) return null;

  let sourceGrossTotal = 0;
  let correctedBase = 0;
  let correctedIgv = 0;
  let detailCount = 0;
  let correctedDetailPreview = [];

  for (const detail of details) {
    const quantity = toNumber(readField(detail, ['cantidad'])) || 0;
    const storedUnitValue = toNumber(readField(detail, ['mto_valor_unitario', 'mtoValorUnitario'])) || 0;
    const percent = toNumber(readField(detail, ['porcentaje_igv', 'porcentajeIgv'])) || 0;
    const tip = String(readField(detail, ['tip_afe_igv', 'tipAfeIgv']) || '');
    const code = String(readField(detail, ['codigo']) || '');

    const grossLine = roundMoney(quantity * storedUnitValue);
    sourceGrossTotal += grossLine;
    detailCount += 1;

    let netLine = grossLine;
    let igvLine = 0;

    if (tip === '10' && percent > 0) {
      const split = splitIgv(grossLine, percent);
      netLine = split.base;
      igvLine = split.igv;
    }

    correctedBase += netLine;
    correctedIgv += igvLine;
    correctedDetailPreview.push(`${code}:${formatMoney(grossLine)}=>${formatMoney(netLine)}`);
  }

  sourceGrossTotal = roundMoney(sourceGrossTotal);
  correctedBase = roundMoney(correctedBase);
  correctedIgv = roundMoney(correctedIgv);
  const correctedTotal = roundMoney(correctedBase + correctedIgv);

  const currentBase = roundMoney(toNumber(row.mtoOperGravadas));
  const currentIgv = roundMoney(toNumber(row.mtoIgv));
  const currentTotal = roundMoney(toNumber(row.mtoImpVenta));

  const deltaBase = roundMoney(correctedBase - currentBase);
  const deltaIgv = roundMoney(correctedIgv - currentIgv);
  const deltaTotal = roundMoney(correctedTotal - currentTotal);
  const isAffected = Math.abs(deltaTotal) >= 0.01;

  return {
    id: row.id,
    companyName: row.companyName,
    companyRuc: row.companyRuc,
    numeroCompleto: row.numeroCompleto,
    orderNumber: row.orderNumber,
    fechaEmision: row.fechaEmision,
    estadoSunat: row.estadoSunat,
    summaryNumero: row.summaryNumero || '',
    summaryEstado: row.summaryEstado || '',
    detailCount,
    currentBase: formatMoney(currentBase),
    currentIgv: formatMoney(currentIgv),
    currentTotal: formatMoney(currentTotal),
    correctedBase: formatMoney(correctedBase),
    correctedIgv: formatMoney(correctedIgv),
    correctedTotal: formatMoney(correctedTotal),
    sourceGrossTotal: formatMoney(sourceGrossTotal),
    deltaBase: formatMoney(deltaBase),
    deltaIgv: formatMoney(deltaIgv),
    deltaTotal: formatMoney(deltaTotal),
    correctedDetailPreview: correctedDetailPreview.join(' | '),
    isAffected,
  };
}

function buildSummaryRows(rows) {
  const summary = [];
  for (const [companyName, companyRows] of groupBy(rows, 'companyName')) {
    const companyRuc = companyRows[0]?.companyRuc || '';
    const affectedCount = companyRows.length;
    const currentTotalSum = roundMoney(sum(companyRows, 'currentTotal'));
    const correctedTotalSum = roundMoney(sum(companyRows, 'correctedTotal'));
    const deltaTotalSum = roundMoney(sum(companyRows, 'deltaTotal'));

    summary.push({
      company_name: companyName,
      company_ruc: companyRuc,
      affected_count: String(affectedCount),
      current_total_sum: formatMoney(currentTotalSum),
      corrected_total_sum: formatMoney(correctedTotalSum),
      delta_total_sum: formatMoney(deltaTotalSum),
    });
  }

  return summary.sort((a, b) => Number(b.affected_count) - Number(a.affected_count));
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const value = row[key];
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(row);
  }
  return map;
}

function writeCsv(filePath, rows) {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const lines = [];
  if (headers.length > 0) lines.push(headers.join(','));
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  }
  writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function stripInternalFields(row) {
  return {
    id: String(row.id),
    company_name: row.companyName,
    company_ruc: row.companyRuc,
    numero_completo: row.numeroCompleto,
    order_number: row.orderNumber,
    fecha_emision: row.fechaEmision,
    estado_sunat: row.estadoSunat,
    summary_numero: row.summaryNumero,
    summary_estado: row.summaryEstado,
    detail_count: String(row.detailCount),
    current_base: row.currentBase,
    current_igv: row.currentIgv,
    current_total: row.currentTotal,
    corrected_base: row.correctedBase,
    corrected_igv: row.correctedIgv,
    corrected_total: row.correctedTotal,
    source_gross_total: row.sourceGrossTotal,
    delta_base: row.deltaBase,
    delta_igv: row.deltaIgv,
    delta_total: row.deltaTotal,
    corrected_detail_preview: row.correctedDetailPreview,
  };
}

function readField(object, keys) {
  for (const key of keys) {
    if (object && Object.prototype.hasOwnProperty.call(object, key)) return object[key];
  }
  return undefined;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function splitIgv(total, percent) {
  const factor = 1 + percent / 100;
  const base = roundMoney(total / factor);
  const igv = roundMoney(total - base);
  return { base, igv };
}

function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sum(rows, key) {
  return rows.reduce((acc, row) => acc + toNumber(row[key]), 0);
}

function roundMoney(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function formatMoney(value) {
  return roundMoney(value).toFixed(2);
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'empresa';
}

function csvEscape(value) {
  const stringValue = String(value ?? '');
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

main();
