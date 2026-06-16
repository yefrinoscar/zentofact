process.env.DATABASE_URL = process.env.DATABASE_URL || 'sqlite:packages/desktop/storage/boletas.db';
process.env.STORAGE_PATH = process.env.STORAGE_PATH || 'packages/desktop/storage';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const core = require('../packages/core/dist');

async function main() {
  const [csvArg, companyArg] = process.argv.slice(2);
  const csvPath = path.resolve(csvArg || 'scripts/output/falabella-anulacion-20260511/affected-aceptadas-consolidado.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV no encontrado: ${csvPath}`);
  }

  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const selectedRows = companyArg
    ? rows.filter((row) => String(row.company_name || '').toLowerCase().includes(String(companyArg).toLowerCase()))
    : rows;

  if (!selectedRows.length) {
    throw new Error(`No hay filas para companyArg=${companyArg || '(todas)'}`);
  }

  const ids = selectedRows.map((row) => Number(row.id)).filter(Number.isFinite);
  const sourceRows = querySourceRows(ids);
  const today = formatLocalDate();

  const grouped = new Map();
  const results = [];

  for (const row of sourceRows) {
    if (row.estadoSunat !== 'ANULADO') {
      results.push({
        success: false,
        boletaId: row.id,
        orderNumber: row.orderNumber,
        numeroCompleto: row.numeroCompleto,
        skipped: true,
        reason: `Estado actual ${row.estadoSunat}; se esperaba ANULADO`,
      });
      continue;
    }

    if (hasAcceptedReplacement(sourceRows, row)) {
      results.push({
        success: true,
        boletaId: row.id,
        orderNumber: row.orderNumber,
        numeroCompleto: row.numeroCompleto,
        skipped: true,
        reason: 'Ya existe una reemisión aceptada para esta orden',
      });
      continue;
    }

    const detalles = buildCorrectedDetails(JSON.parse(row.detalles));
    const created = await core.createBoleta({
      company_id: row.companyId,
      branch_id: row.branchId,
      order_number: row.orderNumber,
      serie: row.serie,
      fecha_emision: today,
      moneda: row.moneda || 'PEN',
      metodo_envio: 'resumen_diario',
      client: {
        tipo_documento: row.clientTipoDocumento,
        numero_documento: row.clientNumeroDocumento,
        razon_social: row.clientRazonSocial,
        direccion: row.clientDireccion || undefined,
      },
      detalles,
      usuario_creacion: 'script:reissue-corrected-falabella',
    });

    const groupKey = `${row.companyId}:${row.branchId}:${today}`;
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        companyId: row.companyId,
        branchId: row.branchId,
        fecha: today,
        boletaIds: [],
      });
    }
    grouped.get(groupKey).boletaIds.push(created.id);

    results.push({
      success: true,
      boletaId: row.id,
      orderNumber: row.orderNumber,
      oldNumeroCompleto: row.numeroCompleto,
      newBoletaId: created.id,
      newNumeroCompleto: created.numeroCompleto,
      created: true,
    });
  }

  const summaries = [];
  for (const group of grouped.values()) {
    const summary = await core.sendBoletasAsDailySummary(
      group.companyId,
      group.branchId,
      group.fecha,
      group.boletaIds,
    );
    summaries.push({
      companyId: group.companyId,
      branchId: group.branchId,
      fecha: group.fecha,
      boletaCount: group.boletaIds.length,
      summary,
    });
  }

  console.log(JSON.stringify({
    csvPath,
    selectedRows: selectedRows.length,
    createdCount: results.filter((result) => result.created).length,
    summaryCount: summaries.length,
    success: summaries.every((entry) => entry.summary?.success),
    results,
    summaries,
  }, null, 2));
}

function parseCsv(content) {
  const [headerLine, ...lines] = content.split(/\r?\n/).filter(Boolean);
  const headers = splitCsvLine(headerLine);
  return lines.map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
  });
}

function splitCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  values.push(current);
  return values;
}

function querySourceRows(ids) {
  const dbPath = process.env.DATABASE_URL.replace('sqlite:', '');
  const idList = ids.join(',');
  const sql = `
    select
      b.id,
      b.company_id as companyId,
      b.branch_id as branchId,
      b.client_id as clientId,
      b.serie,
      b.correlativo,
      b.numero_completo as numeroCompleto,
      b.order_number as orderNumber,
      b.fecha_emision as fechaEmision,
      b.moneda,
      b.estado_sunat as estadoSunat,
      b.detalles,
      cl.tipo_documento as clientTipoDocumento,
      cl.numero_documento as clientNumeroDocumento,
      cl.razon_social as clientRazonSocial,
      cl.direccion as clientDireccion
    from boletas b
    join clients cl on cl.id = b.client_id
    where b.id in (${idList})
    order by b.company_id, b.id
  `;
  const raw = execFileSync('sqlite3', ['-json', dbPath, sql], { encoding: 'utf8' });
  return JSON.parse(raw);
}

function hasAcceptedReplacement(sourceRows, row) {
  return sourceRows.some((candidate) =>
    candidate.id !== row.id &&
    candidate.companyId === row.companyId &&
    candidate.orderNumber &&
    candidate.orderNumber === row.orderNumber &&
    candidate.estadoSunat === 'ACEPTADO',
  );
}

function buildCorrectedDetails(details) {
  return details.map((detail) => {
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
}

function readField(object, keys) {
  for (const key of keys) {
    if (object && Object.prototype.hasOwnProperty.call(object, key)) return object[key];
  }
  return undefined;
}

function toNumber(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : 0;
}

function splitIgv(total, percent) {
  const factor = 1 + percent / 100;
  const base = roundMoney(total / factor);
  const igv = roundMoney(total - base);
  return { base, igv };
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function roundValue(value, decimals = 8) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function formatLocalDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

main().catch((error) => {
  console.error('ERROR', error?.stack || error?.message || String(error));
  process.exit(1);
});
