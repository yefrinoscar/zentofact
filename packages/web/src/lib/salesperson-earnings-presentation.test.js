import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commissionRuleHint,
  commissionRuleIsIncomplete,
  commissionRuleLabel,
  earningsKpis,
  formatCommissionShare,
  incompleteCommissionLabel,
  nextEarningsSort,
  saleItemsLabel,
  salespersonSubtitle,
} from './salesperson-earnings-presentation.ts';

const totals = {
  salespeople: 3,
  withSales: 2,
  ordersCount: 5,
  unitsSold: 9,
  salesTotal: 590,
  commission: 43,
  paidCommission: 23,
  commissionShare: 43 / 590,
  incompleteOrders: 2,
  linesWithoutCommission: 2,
  percentOrders: 1,
  otherCurrencyOrders: 0,
};

test('el % de la venta usa un decimal y no inventa valor sin ventas', () => {
  assert.equal(formatCommissionShare(null), '—');
  assert.equal(formatCommissionShare(0.1), '10%');
  assert.equal(formatCommissionShare(43 / 590), '7.3%');
});

test('los KPIs muestran comisión, ventas y avisan de comisión incompleta', () => {
  const kpis = earningsKpis(totals);
  assert.deepEqual(kpis.map((kpi) => kpi.key), ['commission', 'salesTotal', 'share', 'incomplete']);
  assert.match(kpis[0].value, /43\.00/);
  assert.match(kpis[0].hint, /23\.00 de ventas pagadas/);
  assert.match(kpis[1].hint, /5 ventas · vendieron 2 de 3/);
  assert.equal(kpis[3].tone, 'warning');
  assert.equal(kpis[3].value, '2 ventas');
  const complete = earningsKpis({ ...totals, incompleteOrders: 0 });
  assert.equal(complete[3].tone, 'default');
  assert.equal(earningsKpis(null).length, 0);
});

test('la comisión faltante se nombra, nunca se presenta como completa', () => {
  assert.equal(incompleteCommissionLabel({ incompleteOrders: 0 }), null);
  assert.equal(incompleteCommissionLabel({ incompleteOrders: 1 }), '1 venta sin comisión completa');
  assert.equal(commissionRuleIsIncomplete('partial'), true);
  assert.equal(commissionRuleIsIncomplete('missing'), true);
  assert.equal(commissionRuleIsIncomplete('percent'), false);
  assert.equal(commissionRuleLabel('percent'), '% del vendedor');
  assert.match(commissionRuleHint('partial', 2), /2 productos suman S\/ 0/);
});

test('el orden alterna dirección y empieza descendente salvo por nombre', () => {
  assert.deepEqual(nextEarningsSort({ sortBy: 'commission', sortDir: 'desc' }, 'commission'), { sortBy: 'commission', sortDir: 'asc' });
  assert.deepEqual(nextEarningsSort({ sortBy: 'commission', sortDir: 'desc' }, 'name'), { sortBy: 'name', sortDir: 'asc' });
  assert.deepEqual(nextEarningsSort({ sortBy: 'name', sortDir: 'asc' }, 'salesTotal'), { sortBy: 'salesTotal', sortDir: 'desc' });
});

test('subtítulo del vendedor y resumen de productos', () => {
  assert.equal(salespersonSubtitle({ active: false, commissionPercent: 5 }), '5% si falta comisión · Inactivo');
  assert.equal(salespersonSubtitle({ active: true, commissionPercent: 0 }), '');
  assert.equal(saleItemsLabel([{ name: 'Manta', sku: 'AG301', quantity: 2, unitCommission: 5 }]), 'Manta ×2');
  assert.equal(saleItemsLabel([]), 'Sin productos');
});
