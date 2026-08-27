import test from 'node:test';
import assert from 'node:assert/strict';
import { importSummary, settlementMethodLabel, settlementStatusLabel, unmatchedReasonLabel } from './pagos-presentation.ts';

test('el resumen de importación no habla de duplicados cuando reusa el archivo', () => {
  assert.equal(importSummary({ reused: true, matchedCount: 3, unmatchedCount: 1 }), 'Este archivo ya estaba cargado.');
  assert.equal(importSummary({ reused: false, matchedCount: 2, unmatchedCount: 3 }), '2 cruzadas · 3 sin cruzar');
});

test('el cruce se nombra como en la mesa', () => {
  assert.equal(settlementStatusLabel('matched'), 'Cruzada');
  assert.equal(settlementStatusLabel('unmatched'), 'Sin cruzar');
  assert.equal(settlementMethodLabel('order_id'), 'ID de orden');
  assert.equal(unmatchedReasonLabel('ambiguous_order_id'), 'Varias ventas con el mismo pedido');
  assert.equal(unmatchedReasonLabel('no_unique_match'), 'Sin match único');
});
