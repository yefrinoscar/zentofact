import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import { loadInventoryCount20260821 } from './lib/inventory-count-2026-08-21.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    excel: { type: 'string' },
    out: { type: 'string', default: 'sales-mapping-bundle.json' },
  },
});

config({ path: resolve('.env') });

const excelPath = [
  values.excel,
  process.env.INVENTORY_COUNT_XLSX,
  positionals[0],
  'stock 21.08.2026 a las 2.50 pm.xlsx',
  '/Users/ylaurach/Downloads/stock 21.08.2026 a las 2.50 pm.xlsx',
].filter(Boolean).map((path) => resolve(path)).find((path) => existsSync(path)) || null;

const { pool } = await import('@zentofact/core');
const { SALES_HISTORY_SINCE } = await import('../packages/server/src/catalog/historical-sales-mapping.js');
const {
  EXPORT_SALES_MAPPING_BUNDLE_COMMAND,
  EXPORT_SALES_MAPPING_BUNDLE_REMOTE_COMMAND,
  buildSalesMappingBundle,
  loadFridayWorkbookFromDb,
} = await import('../packages/server/src/catalog/sales-mapping-bundle.js');

try {
  const workbook = excelPath
    ? loadInventoryCount20260821(excelPath)
    : await loadFridayWorkbookFromDb(pool);
  if (!workbook) {
    console.error('No está el Excel del viernes ni un ancla de conciliación con corte 2026-08-21 14:50 Lima.');
    console.error(EXPORT_SALES_MAPPING_BUNDLE_COMMAND);
    console.error(EXPORT_SALES_MAPPING_BUNDLE_REMOTE_COMMAND);
    process.exit(1);
  }
  const bundle = await buildSalesMappingBundle(pool, { workbook, since: SALES_HISTORY_SINCE });
  const out = resolve(values.out);
  writeFileSync(out, `${JSON.stringify(bundle)}\n`);
  if (excelPath) console.log(`Excel: ${excelPath}`);
  else console.log('Conteo: anclas de conciliación del viernes (cutoff_quantity)');
  console.log(`SHA-256: ${workbook.sourceHash}`);
  console.log(`Maestros: ${workbook.targets.length}; unidades: ${workbook.targets.reduce((sum, target) => sum + target.targetQuantity, 0)}`);
  console.log(`Empresas: ${bundle.companies.length}; listings: ${bundle.listings.length}`);
  console.log(`Pedidos: ${bundle.orders.length}; líneas: ${bundle.orders.reduce((sum, order) => sum + order.items.length, 0)}`);
  console.log(`Bundle: ${out}`);
} finally {
  await pool.end();
}
