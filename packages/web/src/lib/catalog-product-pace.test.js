import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogSalesPace, catalogStockHint } from './catalog-product-pace.ts';

test('el ritmo divide las unidades de 7 días y estima cuántos días cubre el stock', () => {
  const pace = catalogSalesPace({ available: 14, unitsSold7d: 7 });
  assert.equal(pace.hasSales, true);
  assert.equal(pace.unitsPerDay, 1);
  assert.equal(pace.daysOfCover, 14);
  assert.equal(pace.rateLabel, '1 u/día');
  assert.equal(pace.coverLabel, 'queda 14 días');
  assert.equal(pace.tone, 'ok');
});

test('sin ventas el ritmo queda en silencio y no inventa cobertura', () => {
  const pace = catalogSalesPace({ available: 20, unitsSold7d: 0 });
  assert.equal(pace.hasSales, false);
  assert.equal(pace.unitsPerDay, 0);
  assert.equal(pace.daysOfCover, null);
  assert.equal(pace.rateLabel, 'Sin venta');
  assert.equal(pace.coverLabel, 'últimos 7 días');
  assert.equal(pace.tone, 'muted');
});

test('stock agotado con venta reciente marca peligro', () => {
  const pace = catalogSalesPace({ available: 0, unitsSold7d: 14 });
  assert.equal(pace.depleted, true);
  assert.equal(pace.daysOfCover, null);
  assert.equal(pace.rateLabel, '2 u/día');
  assert.equal(pace.coverLabel, 'agotado');
  assert.equal(pace.tone, 'danger');
});

test('menos de 3 días de cobertura avisa', () => {
  const pace = catalogSalesPace({ available: 2, unitsSold7d: 14 });
  assert.equal(pace.daysOfCover, 1);
  assert.equal(pace.coverLabel, 'queda 1 día');
  assert.equal(pace.tone, 'warn');
});

test('el hint de stock nombra reservas y devoluciones pendientes', () => {
  assert.equal(catalogStockHint({ quantityReserved: 3, quantityPendingReturn: 1 }), '3 reservadas · 1 por aprobar');
  assert.equal(catalogStockHint({ quantityReserved: 0, quantityPendingReturn: 0 }), null);
});
