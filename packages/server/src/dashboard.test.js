import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDashboardFilters, percentageDelta, normalizeSummary } from './dashboard.js';

test('calcula el periodo anterior con la misma cantidad de días', () => {
  assert.deepEqual(parseDashboardFilters({ from: '2026-07-01', to: '2026-07-07', companyId: '3' }), {
    from: '2026-07-01',
    to: '2026-07-07',
    previousFrom: '2026-06-24',
    previousTo: '2026-06-30',
    companyId: 3,
    branchId: null,
  });
});

test('rechaza rangos invertidos o excesivos', () => {
  assert.throws(() => parseDashboardFilters({ from: '2026-07-08', to: '2026-07-07' }), /posterior/);
  assert.throws(() => parseDashboardFilters({ from: '2020-01-01', to: '2026-07-07' }), /731 días/);
});

test('calcula variaciones sin inventar porcentajes cuando la base es cero', () => {
  assert.equal(percentageDelta(120, 100), 20);
  assert.equal(percentageDelta(0, 0), 0);
  assert.equal(percentageDelta(10, 0), null);
});

test('Pagado y pendiente son lo que llega, no lo vendido', () => {
  const summary = normalizeSummary({
    netSales: 100,
    paidSales: 20,
    pendingSales: 30,
    arrives: 50,
  });
  assert.equal(summary.netSales, 100);
  assert.equal(summary.paidSales, 20);
  assert.equal(summary.pendingSales, 30);
  assert.equal(summary.arrives, 50);
});

test('si no viene arrives, suma pagado y pendiente', () => {
  const summary = normalizeSummary({ paidSales: 12.5, pendingSales: 7.5 });
  assert.equal(summary.arrives, 20);
});
