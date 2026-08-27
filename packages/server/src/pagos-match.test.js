import test from 'node:test';
import assert from 'node:assert/strict';
import { matchSettlementLine, matchSettlementLines, indexSales } from './pagos-match.js';

const sales = [
  {
    source: 'falabella_order',
    id: 1,
    orderId: 'preview-seed-shipped',
    orderNumber: 'PV-10002',
    date: '2026-08-27',
    amount: 189.9,
    skus: ['AG301', 'LIMBO-AG301'],
  },
  {
    source: 'falabella_order',
    id: 2,
    orderId: 'preview-seed-pending',
    orderNumber: 'PV-10001',
    date: '2026-08-27',
    amount: 189.9,
    skus: ['AG301', 'LIMBO-AG301'],
  },
];

test('prioriza el ID de orden Falabella sobre SKU', () => {
  const index = indexSales(sales);
  const match = matchSettlementLine({
    orderId: 'PV-10002',
    sku: 'AG301',
    date: '2026-08-01',
    amount: 10,
  }, index);
  assert.equal(match.status, 'matched');
  assert.equal(match.method, 'order_id');
  assert.equal(match.sale.orderNumber, 'PV-10002');
});

test('SKU fecha y monto solo cruzan si el candidato es único', () => {
  const index = indexSales(sales);
  const ambiguous = matchSettlementLine({
    orderId: '',
    sku: 'AG301',
    date: '2026-08-27',
    amount: 189.9,
  }, index);
  assert.equal(ambiguous.status, 'unmatched');
  assert.equal(ambiguous.reason, 'ambiguous_sku_date_amount');

  const unique = matchSettlementLine({
    orderId: '',
    sku: 'AG301',
    date: '2026-08-27',
    amount: 189.9,
  }, indexSales([sales[0]]));
  assert.equal(unique.status, 'matched');
  assert.equal(unique.method, 'sku_date_amount');
});

test('SKU y monto solo cruzan si son únicos y no adivina', () => {
  const match = matchSettlementLine({
    orderId: '',
    sku: 'AG301',
    amount: 189.9,
  }, indexSales(sales));
  assert.equal(match.status, 'unmatched');
  assert.equal(match.reason, 'ambiguous_sku_amount');
});

test('agrega bruto comisión y neto al marcar la venta pagada', () => {
  const { paidSales, results } = matchSettlementLines([
    { orderId: 'PV-10002', sku: 'AG301', date: '2026-08-27', bruto: 189.9, commission: 0, other: 0, neto: 189.9 },
    { orderId: 'PV-10002', sku: 'AG301', date: '2026-08-27', bruto: 0, commission: 28.49, other: 0, neto: -28.49 },
    { orderId: 'NO-EXISTE', sku: 'ZZZ', date: '2026-08-27', bruto: 10, commission: 0, other: 0, neto: 10, amount: 10 },
  ], sales);
  assert.equal(results.filter((row) => row.status === 'matched').length, 2);
  assert.equal(results.filter((row) => row.status === 'unmatched').length, 1);
  assert.equal(paidSales.length, 1);
  assert.equal(paidSales[0].orderNumber, 'PV-10002');
  assert.equal(paidSales[0].amounts.bruto, 189.9);
  assert.equal(paidSales[0].amounts.commission, 28.49);
  assert.equal(paidSales[0].amounts.neto, 161.41);
});

test('un pedido desconocido no se adivina por SKU', () => {
  const match = matchSettlementLine({
    orderId: '3248910865',
    sku: 'AG301',
    date: '2026-08-27',
    amount: 189.9,
  }, indexSales(sales));
  assert.equal(match.status, 'unmatched');
  assert.equal(match.reason, 'unknown_order_id');
});

test('Estado de pago No Pagado cruza y no marca la venta pagada', () => {
  const { paidSales, results } = matchSettlementLines([
    { orderId: 'PV-10002', sku: 'AG301', date: '2026-08-27', bruto: 189.9, commission: 0, other: 0, neto: 189.9, paid: false },
    { orderId: 'PV-10002', sku: 'AG301', date: '2026-08-27', bruto: 0, commission: 28.49, other: 0, neto: -28.49, paid: false },
  ], sales);
  assert.equal(results.filter((row) => row.status === 'matched').length, 2);
  assert.equal(paidSales.length, 0);
});
