import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUGUST_START,
  PHYSICAL_CUTOFF,
  applyFalabellaAugustPlan,
  calculateInventoryTarget,
  deriveInventoryTransitions,
  hashReconciliationPlan,
  normalizeAugustQuantity,
  resolveFalabellaReconciliationItem,
  summarizeInventoryTransitions,
} from './catalog/falabella-august-reconciliation.js';

function event(id, at, fulfillmentStatus, orderStatus = 'confirmed') {
  return {
    id,
    provider_occurred_at: at,
    new_values: { fulfillmentStatus, orderStatus },
  };
}

test('normaliza 0 a 1 solo cuando raw_data no contiene Quantity', () => {
  assert.deepEqual(normalizeAugustQuantity({ quantity: 0, raw_data: {} }), { quantity: 1, corrected: true });
  assert.deepEqual(normalizeAugustQuantity({ quantity: 0, raw_data: { Quantity: 0 } }), { quantity: 0, corrected: false });
  assert.deepEqual(normalizeAugustQuantity({ quantity: 2, raw_data: {} }), { quantity: 2, corrected: false });
});

test('genera una sola salida y revierte después de un estado terminal', () => {
  const result = deriveInventoryTransitions([
    event(1, '2026-08-21T18:00:00Z', 'ready_to_ship'),
    event(2, '2026-08-21T19:00:00Z', 'shipped'),
    event(3, '2026-08-22T10:00:00Z', 'returned'),
  ], 2);
  assert.deepEqual(result.transitions.map(({ kind, quantityDelta }) => ({ kind, quantityDelta })), [
    { kind: 'exit', quantityDelta: -2 },
    { kind: 'reversal', quantityDelta: 2 },
  ]);
  assert.equal(result.physicallyOut, false);
});

test('el instante exacto del conteo pertenece al periodo posterior', () => {
  const itemPlans = [{ quantity: 1, transitions: [
    { kind: 'exit', quantityDelta: -1, effectiveAt: AUGUST_START },
    { kind: 'reversal', quantityDelta: 1, effectiveAt: PHYSICAL_CUTOFF },
  ] }];
  assert.deepEqual(summarizeInventoryTransitions(itemPlans), {
    beforeCutoff: { exits: 1, reversals: 0, netDelta: -1 },
    afterCutoff: { exits: 0, reversals: 1, netDelta: 1 },
  });
});

test('preserva una cantidad faltante solo cuando no hubo delta posterior', () => {
  assert.deepEqual(calculateInventoryTarget({
    currentQuantity: 12, countedQuantity: 0, countUnresolved: true,
    preCutoffDelta: -3, postCutoffDelta: 0,
  }), {
    cutoffQuantity: 12, openingQuantity: 15, calculatedTargetQuantity: 12,
    shortageQuantity: 0, targetQuantity: 12,
  });
  assert.equal(calculateInventoryTarget({
    currentQuantity: 12, countedQuantity: 0, countUnresolved: true,
    preCutoffDelta: 0, postCutoffDelta: -1,
  }).cutoffQuantity, null);
});

test('un faltante conserva objetivo cero y una cantidad explícita para reconocer', () => {
  assert.deepEqual(calculateInventoryTarget({
    currentQuantity: 0, countedQuantity: 0, countUnresolved: false,
    preCutoffDelta: 0, postCutoffDelta: -5,
  }), {
    cutoffQuantity: 0, openingQuantity: 0, calculatedTargetQuantity: -5,
    shortageQuantity: 5, targetQuantity: 0,
  });
});

test('resuelve solo listing activo exacto o mapeo histórico explícito', () => {
  const products = [
    { id: 10, main_sku: 'EXACT' },
    { id: 116, main_sku: 'H9XLN' },
    { id: 270, main_sku: 'FAL-146325783' },
  ];
  const listings = [
    { id: 20, product_id: 10, company_id: 3, seller_sku: 'seller-1', shop_sku: 'shop-1', status: 'active' },
    { id: 6877, product_id: 999, company_id: 4, seller_sku: '140746934', shop_sku: '156576540', status: 'unlinked' },
  ];
  assert.equal(resolveFalabellaReconciliationItem({ company_id: 3, sku: 'seller-1' }, listings, products).product.id, 10);
  const historical = resolveFalabellaReconciliationItem({ company_id: 4, sku: '140746934' }, listings, products);
  assert.equal(historical.product.id, 116);
  assert.equal(historical.method, 'explicit_historical_sku');
  assert.equal(resolveFalabellaReconciliationItem({
    company_id: 3, sku: '357258624678',
  }, listings, products).product.id, 270);
  assert.equal(resolveFalabellaReconciliationItem({ company_id: 3, sku: 'seller' }, listings, products), null);
});

test('el hash es estable ante el orden de claves pero cambia con el plan', () => {
  const base = {
    sourceHash: 'source', cutoffAt: PHYSICAL_CUTOFF, asOf: '2026-08-24T20:15:16.432Z',
    commercialSales: { units: 10 }, eventTotals: {}, quantityCorrections: [], mappings: [],
    blockers: [], shortages: [], products: [], itemPlans: [],
  };
  const reordered = {
    itemPlans: [], products: [], shortages: [], blockers: [], mappings: [], quantityCorrections: [],
    eventTotals: {}, commercialSales: { units: 10 }, asOf: base.asOf,
    cutoffAt: base.cutoffAt, sourceHash: base.sourceHash,
  };
  assert.equal(hashReconciliationPlan(base), hashReconciliationPlan(reordered));
  assert.notEqual(hashReconciliationPlan(base), hashReconciliationPlan({ ...base, commercialSales: { units: 11 } }));
});

test('una segunda aplicación con el mismo run_key no recalcula ni escribe', async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(String(sql));
      if (String(sql).startsWith('select * from inventory_reconciliation_runs')) {
        return { rows: [{ id: 8, run_key: 'existing', plan_hash: 'hash' }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  const pool = { async connect() { return client; } };
  const result = await applyFalabellaAugustPlan(pool, {
    workbook: { sourceHash: 'a'.repeat(64) }, asOf: '2026-08-24T20:15:16.432Z', expectedPlanHash: 'hash',
  });
  assert.equal(result.idempotent, true);
  assert.equal(queries.includes('commit'), true);
  assert.equal(queries.some((sql) => sql.includes('insert into inventory_reconciliation_runs')), false);
});
