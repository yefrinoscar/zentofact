import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import {
  INVENTORY_COUNT_MASTER_SKUS,
  INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY,
} from './lib/inventory-count-2026-08-21.mjs';

const { values } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    since: { type: 'string' },
    'review-out': { type: 'string', default: '.audit/sales-mapping-since-may-2026-review.tsv' },
  },
});

config({ path: resolve('.env') });

const { pool } = await import('@zentofact/core');
const {
  SALES_HISTORY_SINCE,
  applyHistoricalSalesMappings,
  buildHistoricalSalesCoverage,
  formatReviewTsv,
  loadHistoricalSalesMappingContext,
} = await import('../packages/server/src/catalog/historical-sales-mapping.js');

const since = values.since || SALES_HISTORY_SINCE;
const reviewOut = resolve(values['review-out']);

function printCoverage(coverage) {
  console.log(`Ventas desde: ${coverage.since}`);
  console.log(`Conteo físico (no se descuenta aquí): ${coverage.cutoffAt}`);
  console.log('Canales: falabella, ripley');
  console.log('Este comando no copia el catálogo a Railway ni escribe inventario.');
  console.table([coverage.summary]);
  if (coverage.review.length) {
    console.log(`Identidades para revisión humana: ${coverage.review.length}`);
    console.table(coverage.review.slice(0, 40).map((row) => ({
      canal: row.channel,
      empresa: row.company_id,
      sellerSku: row.seller_sku,
      shopSku: row.shop_sku,
      lineas: row.lines,
      unidades: row.units,
      estado: row.status,
      motivo: row.reason,
    })));
    if (coverage.review.length > 40) {
      console.log(`… ${coverage.review.length - 40} identidades más en ${reviewOut}`);
    }
  }
}

try {
  const loaded = await loadHistoricalSalesMappingContext(pool, { since });
  const coverage = buildHistoricalSalesCoverage({
    ...loaded,
    countedSkus: INVENTORY_COUNT_MASTER_SKUS,
    skusWithoutQuantity: INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY,
    since,
  });
  printCoverage(coverage);
  mkdirSync(dirname(reviewOut), { recursive: true });
  writeFileSync(reviewOut, formatReviewTsv(coverage.identities));
  console.log(`Lista de revisión: ${reviewOut}`);
  if (!values.apply) {
    console.log('DRY RUN: no se modificó la base. Usa --apply para asociar líneas ciertas sin mover stock.');
  } else {
    const result = await applyHistoricalSalesMappings(pool, {
      since,
      countedSkus: INVENTORY_COUNT_MASTER_SKUS,
      skusWithoutQuantity: INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY,
    });
    console.log(`APLICADO: ${result.updatedItems} líneas asociadas, ${result.createdListings} listings inactivos creados; inventario sin cambios.`);
  }
} finally {
  await pool.end();
}
