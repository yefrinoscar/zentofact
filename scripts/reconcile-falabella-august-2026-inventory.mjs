import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import { loadInventoryCount20260821 } from './lib/inventory-count-2026-08-21.mjs';

const DEFAULT_AS_OF = '2026-08-24T20:15:16.432Z';
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    apply: { type: 'boolean', default: false },
    'plan-hash': { type: 'string' },
    'as-of': { type: 'string', default: DEFAULT_AS_OF },
    'acknowledge-shortages': { type: 'boolean', default: false },
  },
});

if (!positionals[0]) throw new Error('Indica la ruta del Excel de stock.');
if (values.apply && !values['plan-hash']) {
  throw new Error('Para aplicar usa --apply --plan-hash=<hash exacto del dry run>.');
}
const workbookPath = resolve(positionals[0]);
config({ path: resolve('.env') });
const workbook = loadInventoryCount20260821(workbookPath);
const { pool, runMigrations } = await import('@zentofact/core');
const {
  applyFalabellaAugustPlan,
  buildFalabellaAugustPlan,
} = await import('../packages/server/src/catalog/falabella-august-reconciliation.js');

function printPlan(plan) {
  console.log(`Archivo: ${basename(workbookPath)}`);
  console.log(`SHA-256 Excel: ${plan.sourceHash}`);
  console.log(`Conteo físico: ${plan.cutoffAt} (21/08/2026 14:50, Lima)`);
  console.log(`Datos de marketplace hasta: ${plan.asOf}`);
  console.log(`Plan hash: ${plan.planHash}`);
  console.table([{
    pedidos_agosto: plan.commercialSales.orders,
    lineas_agosto: plan.commercialSales.lines,
    unidades_agosto: plan.commercialSales.units,
    cantidades_0_corregidas: plan.quantityCorrections.length,
  }]);
  console.table([
    {
      periodo: '01/08 → conteo', salidas: plan.eventTotals.beforeCutoff.exits,
      reversiones: plan.eventTotals.beforeCutoff.reversals,
      neto: plan.eventTotals.beforeCutoff.netDelta,
    },
    {
      periodo: 'conteo → as-of', salidas: plan.eventTotals.afterCutoff.exits,
      reversiones: plan.eventTotals.afterCutoff.reversals,
      neto: plan.eventTotals.afterCutoff.netDelta,
    },
  ]);
  console.table(plan.products.map((product) => ({
    sku: product.mainSku, apertura_agosto: product.openingQuantity,
    conteo_21_ago: product.cutoffQuantity, delta_despues: product.postCutoffDelta,
    faltante_antes_conteo: product.preCutoffShortageQuantity,
    faltante_despues_conteo: product.shortageQuantity, objetivo_actual: product.targetQuantity,
    stock_db_actual: product.currentQuantity,
  })));
  if (plan.quantityCorrections.length) {
    console.log('Cantidades corregibles (0 → 1 porque raw_data no contiene Quantity):');
    console.table(plan.quantityCorrections);
  }
  if (plan.shortages.length) {
    console.log('Faltantes físicos. El objetivo final queda en 0, nunca negativo:');
    console.table(plan.shortages);
  }
  if (plan.blockers.length) {
    console.log('BLOQUEOS. No se puede aplicar parcialmente:');
    console.table(plan.blockers);
  }
}

try {
  if (values.apply) await runMigrations(pool);
  const plan = await buildFalabellaAugustPlan(pool, { workbook, asOf: values['as-of'] });
  printPlan(plan);
  if (!values.apply) {
    console.log('DRY RUN: no se modificó la base.');
    console.log(`Para aplicar este plan exacto: --apply --plan-hash=${plan.planHash}`);
    if (plan.shortages.length) console.log('Los faltantes también requieren --acknowledge-shortages.');
  } else {
    const result = await applyFalabellaAugustPlan(pool, {
      workbook, asOf: values['as-of'], expectedPlanHash: values['plan-hash'],
      acknowledgeShortages: values['acknowledge-shortages'],
    });
    console.log(result.idempotent
      ? `SIN CAMBIOS: la corrida ${result.run.run_key} ya estaba aplicada.`
      : `APLICADO: corrida ${result.run.run_key}.`);
  }
} finally {
  await pool.end();
}
