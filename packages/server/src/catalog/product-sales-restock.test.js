import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coverDays,
  fillDailyOverview,
  fillDailySeries,
  keepsMoney,
  keepsPerDay,
  pickRestockLists,
  productRestock,
  restockQuantity,
  seriesPace,
  unitsPerDay,
  weekendShare,
} from './product-sales-restock.js';

test('el ritmo y la cantidad a traer descuentan el stock del horizonte', () => {
  assert.equal(unitsPerDay(72, 30), 2.4);
  assert.equal(restockQuantity({ unitsPerDay: 2.4, available: 8, horizonDays: 30 }), 64);
  assert.equal(restockQuantity({ unitsPerDay: 2.4, available: 80, horizonDays: 30 }), 0);
  assert.equal(restockQuantity({ unitsPerDay: 0, available: 0 }), 0);
  assert.equal(coverDays(8, 2.4), 8 / 2.4);
  assert.equal(coverDays(8, 0), null);
});

test('te deja resta el precio por mayor cuando existe', () => {
  const withCost = keepsMoney({ arrives: 1440, unitsSold: 72, wholesalePrice: 101 });
  assert.equal(withCost.hasWholesaleCost, true);
  assert.equal(withCost.keeps, 1440 - 101 * 72);
  assert.equal(withCost.keepsPerUnit, (1440 - 101 * 72) / 72);
  assert.equal(keepsPerDay(withCost.keeps, 30), withCost.keeps / 30);

  const withoutCost = keepsMoney({ arrives: 1440, unitsSold: 72, wholesalePrice: null });
  assert.equal(withoutCost.hasWholesaleCost, false);
  assert.equal(withoutCost.keeps, 1440);
  assert.equal(keepsMoney({ arrives: null, unitsSold: 72, wholesalePrice: 10 }).keeps, null);
});

test('la curva llena días vacíos y detecta alza o fin de semana', () => {
  const series = fillDailySeries('2026-08-13', '2026-08-16', [
    { date: '2026-08-13', units: 1 },
    { date: '2026-08-16', units: 4 },
  ]);
  assert.deepEqual(series.map((point) => point.units), [1, 0, 0, 4]);
  assert.deepEqual(
    fillDailyOverview('2026-08-13', '2026-08-14', [{ day: '2026-08-13', units: 2, revenue: 40 }]).map((point) => point.revenue),
    [40, 0],
  );
  assert.equal(seriesPace([
    { units: 1 }, { units: 1 }, { units: 3 }, { units: 4 },
  ]), 'up');
  assert.equal(seriesPace([
    { units: 4 }, { units: 3 }, { units: 1 }, { units: 1 },
  ]), 'down');
  const weekend = weekendShare([
    { date: '2026-09-10', units: 1 },
    { date: '2026-09-11', units: 5 },
    { date: '2026-09-12', units: 4 },
  ]);
  assert.ok(weekend > 0.8);
});

test('traer ahora prioriza lo que deja más al día y omite stock parado', () => {
  const from = '2026-08-14';
  const to = '2026-09-12';
  const stroller = productRestock({
    productKey: 'p:294',
    sku: 'AG294',
    name: 'Coche bastón plegable',
    unitsSold: 72,
    arrives: 8712,
    wholesalePrice: 101,
    available: 8,
  }, { from, to });
  const gloves = productRestock({
    productKey: 'p:293',
    sku: 'AG293',
    name: 'Guantes de invierno táctiles',
    unitsSold: 9,
    arrives: 252,
    wholesalePrice: 8,
    available: 28,
  }, { from, to });
  const sash = productRestock({
    productKey: 'p:295',
    sku: 'AG295',
    name: 'Camiseta faja reductora M',
    unitsSold: 123,
    arrives: 732,
    wholesalePrice: 4,
    available: 200,
  }, { from, to });

  assert.equal(stroller.unitsPerDay, 2.4);
  assert.equal(stroller.keepsPerDay, 48);
  assert.equal(stroller.restockQty, 64);
  assert.ok(stroller.coverDays < 4);
  assert.ok(gloves.coverDays > 45);
  assert.equal(gloves.restockQty, 0);
  assert.equal(sash.restockQty, 0);

  const lists = pickRestockLists([stroller, gloves, sash]);
  assert.deepEqual(lists.items.map((item) => item.sku), ['AG294']);
  assert.deepEqual(lists.skip.map((item) => item.sku).sort(), ['AG293', 'AG295']);
  assert.equal(lists.skip.find((item) => item.sku === 'AG293')?.skipReason, 'overstock');
  assert.equal(lists.points.some((point) => point.sku === 'AG294' && point.group === 'bring'), true);
  assert.equal(lists.points.some((point) => point.sku === 'AG293' && point.group === 'skip'), true);
});
