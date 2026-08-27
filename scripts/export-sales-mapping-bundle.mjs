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
].filter(Boolean).map((path) => resolve(path)).find((path) => existsSync(path));

if (!excelPath) {
  console.error('Falta el Excel del viernes. Pásalo con --excel.');
  process.exit(1);
}

const { pool } = await import('@zentofact/core');
const { SALES_HISTORY_SINCE } = await import('../packages/server/src/catalog/historical-sales-mapping.js');
const { buildSalesMappingBundle } = await import('../packages/server/src/catalog/sales-mapping-bundle.js');

try {
  const workbook = loadInventoryCount20260821(excelPath);
  const bundle = await buildSalesMappingBundle(pool, { workbook, since: SALES_HISTORY_SINCE });
  const out = resolve(values.out);
  writeFileSync(out, `${JSON.stringify(bundle)}\n`);
  console.log(`Excel: ${excelPath}`);
  console.log(`SHA-256: ${workbook.sourceHash}`);
  console.log(`Maestros: ${workbook.targets.length}; unidades: ${workbook.targets.reduce((sum, target) => sum + target.targetQuantity, 0)}`);
  console.log(`Empresas: ${bundle.companies.length}; listings: ${bundle.listings.length}`);
  console.log(`Pedidos: ${bundle.orders.length}; líneas: ${bundle.orders.reduce((sum, order) => sum + order.items.length, 0)}`);
  console.log(`Bundle: ${out}`);
} finally {
  await pool.end();
}
