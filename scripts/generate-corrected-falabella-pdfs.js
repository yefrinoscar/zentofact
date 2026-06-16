#!/usr/bin/env node

const { execFileSync } = require('child_process');
const { mkdirSync, writeFileSync } = require('fs');
const { join, resolve } = require('path');
const { generateBoletaPdf } = require('../packages/core/dist/services/pdf.service.js');
const { calculateTotals } = require('../packages/core/dist/utils/tax-calculator.js');

const DEFAULT_DB_PATH = resolve(process.cwd(), 'packages/desktop/storage/boletas.db');
const OUTPUT_ROOT = resolve(process.cwd(), 'scripts/output');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = resolve(process.cwd(), args.db || DEFAULT_DB_PATH);
  const timestamp = formatTimestamp(new Date());
  const outDir = resolve(process.cwd(), args.out || join(OUTPUT_ROOT, `falabella-corrected-pdfs-${timestamp}`));
  const limit = args.limit ? Number(args.limit) : null;
  const companyFilter = args.company || '';
  const format = args.format || 'A4';
  const orderFilters = new Set(args.orders || []);

  const rows = queryCandidateBoletas(dbPath)
    .filter((row) => !companyFilter || row.companyName === companyFilter)
    .filter((row) => orderFilters.size === 0 || orderFilters.has(String(row.orderNumber || '')))
    .filter((row) => isAffected(row));

  const selected = Number.isFinite(limit) && limit > 0 ? rows.slice(0, limit) : rows;
  if (selected.length === 0) {
    console.log('No se encontraron boletas afectadas con ese filtro.');
    return;
  }

  mkdirSync(outDir, { recursive: true });
  const manifest = [];

  for (const row of selected) {
    const corrected = buildCorrectedPdfData(row);
    const pdfBuffer = await generateBoletaPdf(corrected, format);
    const companyDir = join(outDir, slugify(row.companyName));
    mkdirSync(companyDir, { recursive: true });
    const filename = `${row.numeroCompleto}-corrected.pdf`;
    const filePath = join(companyDir, filename);
    writeFileSync(filePath, pdfBuffer);

    manifest.push({
      company_name: row.companyName,
      numero_completo: row.numeroCompleto,
      order_number: row.orderNumber,
      fecha_emision: row.fechaEmision,
      corrected_total: corrected.mtoImpVenta,
      output_pdf: filePath,
    });
  }

  writeCsv(join(outDir, 'manifest.csv'), manifest);
  console.log(`PDFs generados: ${selected.length}`);
  console.log(`Output: ${outDir}`);
}

function parseArgs(argv) {
  const result = { orders: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--db' && argv[i + 1]) result.db = argv[++i];
    else if (token === '--out' && argv[i + 1]) result.out = argv[++i];
    else if (token === '--company' && argv[i + 1]) result.company = argv[++i];
    else if (token === '--limit' && argv[i + 1]) result.limit = argv[++i];
    else if (token === '--format' && argv[i + 1]) result.format = argv[++i];
    else if (token === '--order' && argv[i + 1]) result.orders.push(argv[++i]);
  }
  return result;
}

function queryCandidateBoletas(dbPath) {
  const sql = `
    select
      b.id,
      b.serie,
      b.correlativo,
      b.numero_completo as numeroCompleto,
      b.order_number as orderNumber,
      b.fecha_emision as fechaEmision,
      b.moneda,
      b.detalles,
      b.codigo_hash as codigoHash,
      c.razon_social as companyName,
      c.ruc as companyRuc,
      c.nombre_comercial as companyTradeName,
      c.direccion as companyDireccion,
      c.ubigeo as companyUbigeo,
      c.logo_path as companyLogoPath,
      br.codigo as branchCodigo,
      br.nombre as branchNombre,
      br.direccion as branchDireccion,
      cl.tipo_documento as clientTipoDocumento,
      cl.numero_documento as clientNumeroDocumento,
      cl.razon_social as clientRazonSocial,
      cl.direccion as clientDireccion
    from boletas b
    join companies c on c.id = b.company_id
    join branches br on br.id = b.branch_id
    join clients cl on cl.id = b.client_id
    where b.order_number is not null
      and b.detalles is not null
      and json_array_length(b.detalles) > 0
    order by c.razon_social, b.fecha_emision, b.numero_completo
  `;

  const raw = execFileSync('sqlite3', ['-json', dbPath, sql], { encoding: 'utf8' });
  return JSON.parse(raw);
}

function isAffected(row) {
  const details = safeJsonParse(row.detalles);
  if (!Array.isArray(details) || details.length === 0) return false;
  const firstCode = String(readField(details[0], ['codigo']) || '');
  if (!firstCode || firstCode === row.orderNumber) return false;

  const storedTotal = roundMoney(sumDetails(details, 'storedGross'));
  const correctedTotals = calculateCorrectedTotals(details);
  return Math.abs(roundMoney(correctedTotals.mtoImpVenta) - storedTotal) < 0.01
    && Math.abs(correctedTotals.mtoImpVenta - correctedTotals.currentBuggedTotal) >= 0.01;
}

function buildCorrectedPdfData(row) {
  const details = safeJsonParse(row.detalles) || [];
  const correctedDetails = details.map((detail) => {
    const quantity = Math.max(1, toNumber(readField(detail, ['cantidad'])) || 1);
    const storedUnitGross = toNumber(readField(detail, ['mto_valor_unitario', 'mtoValorUnitario'])) || 0;
    const percent = toNumber(readField(detail, ['porcentaje_igv', 'porcentajeIgv'])) || 0;
    const tip = String(readField(detail, ['tip_afe_igv', 'tipAfeIgv']) || '10');
    const grossLine = roundMoney(quantity * storedUnitGross);

    let unitNet = storedUnitGross;
    if (tip === '10' && percent > 0) {
      const split = splitIgv(grossLine, percent);
      unitNet = roundValue(split.base / quantity, 8);
    }

    return {
      codigo: String(readField(detail, ['codigo']) || ''),
      descripcion: String(readField(detail, ['descripcion']) || ''),
      unidad: String(readField(detail, ['unidad']) || 'NIU'),
      cantidad: quantity,
      mto_valor_unitario: unitNet,
      porcentaje_igv: percent,
      tip_afe_igv: tip,
    };
  });

  const totals = calculateTotals(correctedDetails);

  return {
    company: {
      ruc: row.companyRuc,
      razonSocial: row.companyName,
      nombreComercial: row.companyTradeName || undefined,
      direccion: row.companyDireccion || '',
      ubigeo: row.companyUbigeo || '',
    },
    branch: {
      codigo: row.branchCodigo,
      nombre: row.branchNombre,
      direccion: row.branchDireccion || '',
    },
    client: {
      tipoDocumento: row.clientTipoDocumento,
      numeroDocumento: row.clientNumeroDocumento,
      razonSocial: row.clientRazonSocial,
      direccion: row.clientDireccion || undefined,
    },
    serie: row.serie,
    correlativo: row.correlativo,
    numeroCompleto: row.numeroCompleto,
    fechaEmision: row.fechaEmision,
    moneda: row.moneda || 'PEN',
    detalles: correctedDetails,
    mtoOperGravadas: formatMoney(totals.mtoOperGravadas),
    mtoOperExoneradas: formatMoney(totals.mtoOperExoneradas),
    mtoOperInafectas: formatMoney(totals.mtoOperInafectas),
    mtoOperGratuitas: formatMoney(totals.mtoOperGratuitas),
    mtoIgv: formatMoney(totals.mtoIgv),
    mtoIgvGratuitas: formatMoney(totals.mtoIgvGratuitas),
    mtoIsc: formatMoney(totals.mtoIsc),
    mtoIcbper: formatMoney(totals.mtoIcbper),
    totalImpuestos: formatMoney(totals.totalImpuestos),
    subTotal: formatMoney(totals.subTotal),
    mtoImpVenta: formatMoney(totals.mtoImpVenta),
    codigoHash: row.codigoHash || undefined,
    logoPath: row.companyLogoPath || undefined,
  };
}

function calculateCorrectedTotals(details) {
  let sourceGrossTotal = 0;
  const normalized = details.map((detail) => {
    const quantity = Math.max(1, toNumber(readField(detail, ['cantidad'])) || 1);
    const storedUnitGross = toNumber(readField(detail, ['mto_valor_unitario', 'mtoValorUnitario'])) || 0;
    const percent = toNumber(readField(detail, ['porcentaje_igv', 'porcentajeIgv'])) || 0;
    const tip = String(readField(detail, ['tip_afe_igv', 'tipAfeIgv']) || '10');
    const grossLine = roundMoney(quantity * storedUnitGross);
    sourceGrossTotal += grossLine;

    let unitNet = storedUnitGross;
    if (tip === '10' && percent > 0) {
      const split = splitIgv(grossLine, percent);
      unitNet = roundValue(split.base / quantity, 8);
    }

    return {
      codigo: String(readField(detail, ['codigo']) || ''),
      descripcion: String(readField(detail, ['descripcion']) || ''),
      unidad: String(readField(detail, ['unidad']) || 'NIU'),
      cantidad: quantity,
      mto_valor_unitario: unitNet,
      porcentaje_igv: percent,
      tip_afe_igv: tip,
    };
  });

  const totals = calculateTotals(normalized);
  return {
    ...totals,
    sourceGrossTotal: roundMoney(sourceGrossTotal),
    currentBuggedTotal: roundMoney(sourceGrossTotal + totals.mtoIgv),
  };
}

function sumDetails(details, mode) {
  return details.reduce((acc, detail) => {
    const quantity = Math.max(1, toNumber(readField(detail, ['cantidad'])) || 1);
    const storedUnitGross = toNumber(readField(detail, ['mto_valor_unitario', 'mtoValorUnitario'])) || 0;
    if (mode === 'storedGross') return acc + roundMoney(quantity * storedUnitGross);
    return acc;
  }, 0);
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

function roundMoney(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function roundValue(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(toNumber(value) * factor) / factor;
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

function writeCsv(filePath, rows) {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const lines = [];
  if (headers.length > 0) lines.push(headers.join(','));
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  }
  writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
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

main().catch((error) => {
  console.error('ERROR', error.stack || error.message);
  process.exit(1);
});
