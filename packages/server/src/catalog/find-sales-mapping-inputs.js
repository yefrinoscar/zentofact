import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';

const JSON_EXT = new Set(['.json']);
const EXCEL_EXT = new Set(['.xlsx', '.xlsm']);
const SQL_EXT = new Set(['.sql']);

export const DEFAULT_DROP_DIRECTORIES = Object.freeze([
  '/opt/cursor/uploads',
  '/opt/cursor/artifacts',
  '/tmp',
  '/home/ubuntu/Downloads',
  '/home/ubuntu',
]);

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function listFiles(directory) {
  try {
    return readdirSync(directory)
      .map((name) => resolve(directory, name))
      .filter((path) => isFile(path));
  } catch {
    return [];
  }
}

function peek(path, bytes = 8000) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const buffer = Buffer.alloc(bytes);
    const read = readSync(fd, buffer, 0, bytes, 0);
    return buffer.slice(0, read).toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function isSalesMappingBundleText(text) {
  const sample = String(text || '');
  if (!/"version"\s*:\s*1\b/.test(sample)) return false;
  const hasSales = /"orders"\s*:\s*\[\s*\{/.test(sample)
    || /"falabellaOrders"\s*:\s*\[\s*\{/.test(sample);
  if (/"error"\s*:/.test(sample) && !/"excel"\s*:/.test(sample) && !hasSales) return false;
  return /"excel"\s*:/.test(sample) || /"orders"\s*:/.test(sample) || /"cutoffAt"\s*:/.test(sample) || hasSales;
}

export function isOrdersDumpText(text) {
  const sample = String(text || '');
  if (/(?:COPY|INSERT\s+INTO)\s+(?:public\.)?(?:products|product_inventory|inventory_movements)\b/i.test(sample)) {
    return false;
  }
  return /(?:COPY|INSERT\s+INTO)\s+(?:public\.)?orders\b/i.test(sample);
}

export function isFridayCountWorkbookName(name) {
  const file = String(name || '');
  if (/reporte_empresas/i.test(file)) return false;
  return /stock|21\.08|2\.50|conteo|inventario/i.test(file);
}

export function discoverSalesMappingInputs({
  excel: excelHint,
  bundle: bundleHint,
  ordersSql: ordersHint,
  cwd = process.cwd(),
  extraDirectories = [],
  directories,
} = {}) {
  const scanDirectories = [...new Set((
    directories || [...DEFAULT_DROP_DIRECTORIES, resolve(cwd), ...extraDirectories]
  ).map((path) => resolve(path)))];
  const namedExcel = [excelHint, resolve(cwd, 'stock 21.08.2026 a las 2.50 pm.xlsx')]
    .filter(Boolean)
    .map((path) => resolve(path))
    .find((path) => isFile(path)) || null;
  const namedBundle = [bundleHint, resolve(cwd, 'sales-mapping-bundle.json')]
    .filter(Boolean)
    .map((path) => resolve(path))
    .find((path) => isFile(path)) || null;
  const namedSql = [ordersHint, resolve(cwd, 'orders-since-may.sql')]
    .filter(Boolean)
    .map((path) => resolve(path))
    .find((path) => isFile(path)) || null;

  const files = scanDirectories.flatMap(listFiles);
  const excel = namedExcel
    || files.find((path) => EXCEL_EXT.has(extname(path).toLowerCase()) && isFridayCountWorkbookName(basename(path)))
    || files.find((path) => (
      EXCEL_EXT.has(extname(path).toLowerCase())
      && /(?:^|\/)uploads\//.test(path)
      && !/reporte_empresas/i.test(basename(path))
    ))
    || null;
  const bundle = namedBundle
    || files.find((path) => JSON_EXT.has(extname(path).toLowerCase()) && isSalesMappingBundleText(peek(path)))
    || null;
  const ordersSql = namedSql
    || files.find((path) => SQL_EXT.has(extname(path).toLowerCase()) && isOrdersDumpText(peek(path)))
    || null;

  return { excel, bundle, ordersSql };
}
