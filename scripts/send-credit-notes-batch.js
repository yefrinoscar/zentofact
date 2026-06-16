process.env.DATABASE_URL = process.env.DATABASE_URL || 'sqlite:packages/desktop/storage/boletas.db';
process.env.STORAGE_PATH = process.env.STORAGE_PATH || 'packages/desktop/storage';

const fs = require('fs');
const path = require('path');
const core = require('../packages/core/dist');

async function main() {
  const [csvArg, companyArg] = process.argv.slice(2);
  const csvPath = csvArg || 'scripts/output/falabella-anulacion-20260511/affected-aceptadas-consolidado.csv';
  const absoluteCsvPath = path.resolve(csvPath);

  if (!fs.existsSync(absoluteCsvPath)) {
    throw new Error(`CSV no encontrado: ${absoluteCsvPath}`);
  }

  const rows = parseCsv(fs.readFileSync(absoluteCsvPath, 'utf-8'));
  const filteredRows = companyArg
    ? rows.filter((row) => String(row.company_name || '').toLowerCase().includes(String(companyArg).toLowerCase()))
    : rows;

  if (!filteredRows.length) {
    throw new Error(`No hay filas para companyArg=${companyArg || '(todas)'}`);
  }

  const boletaIds = filteredRows.map((row) => Number(row.id)).filter(Number.isFinite);
  const result = await core.createAndSendCreditNotesFromBoletas(boletaIds, {
    codMotivo: '01',
    desMotivo: 'ANULACION DE LA OPERACION',
    usuarioCreacion: 'script:credit-note-batch',
  });

  console.log(JSON.stringify({
    csvPath: absoluteCsvPath,
    selectedRows: filteredRows.length,
    createdIds: result.createdIds,
    success: result.success,
    results: result.results,
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

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('ERROR', error?.stack || error?.message || String(error));
    process.exit(1);
  });
