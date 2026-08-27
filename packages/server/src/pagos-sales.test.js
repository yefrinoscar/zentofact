import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSettlementCsv } from './pagos-csv.js';
import { aggregateSettlementSales, summarizeSettlementSales } from './pagos-sales.js';

const HEADER = [
  '"Fecha creación de la orden"',
  '"Nombre del producto"',
  '"N° del orden"',
  '"SKU vendedor"',
  '"Falabella-Id"',
  '"Tipo de transacción"',
  '"Monto con IVA"',
  '"% comisión"',
  '"Estado de pago"',
].join(',');

function row(overrides = {}) {
  const values = {
    'Fecha creación de la orden': '2026-08-19 09:25:12',
    'Nombre del producto': 'Manta térmica',
    'N° del orden': '3248910865',
    'SKU vendedor': 'MTC12367890',
    'Falabella-Id': 'item-1',
    'Tipo de transacción': 'Pago por precio del producto',
    'Monto con IVA': '8.99',
    '% comisión': '0.15',
    'Estado de pago': 'Pagado',
    ...overrides,
  };
  return [
    values['Fecha creación de la orden'],
    values['Nombre del producto'],
    values['N° del orden'],
    values['SKU vendedor'],
    values['Falabella-Id'],
    values['Tipo de transacción'],
    values['Monto con IVA'],
    values['% comisión'],
    values['Estado de pago'],
  ].map((value) => `"${value}"`).join(',');
}

test('agrega comisión envío y porcentaje por pedido sin inflar el envío comprador', () => {
  const csv = [
    HEADER,
    row(),
    row({ 'Tipo de transacción': 'Cobro por comisión por venta', 'Monto con IVA': '-1.35' }),
    row({ 'Tipo de transacción': 'Cobro por cofinanciamiento logístico', 'Monto con IVA': '-3.9' }),
    row({ 'Tipo de transacción': 'Pago de envío comprador', 'Monto con IVA': '3.17' }),
    row({ 'Tipo de transacción': 'Reversa de pago de envío comprador', 'Monto con IVA': '-3.17' }),
  ].join('\n');
  const parsed = parseSettlementCsv(csv);
  const [sale] = aggregateSettlementSales(parsed.lines);
  assert.equal(sale.orderId, '3248910865');
  assert.equal(sale.bruto, 8.99);
  assert.equal(sale.commission, 1.35);
  assert.equal(sale.commissionRate, 0.15);
  assert.equal(sale.shipping, 3.9);
  assert.equal(sale.buyerShipping, 0);
  assert.equal(sale.neto, 3.74);
  assert.equal(sale.take, 5.25);
  assert.equal(sale.takeRate, 0.584);
  assert.equal(sale.items.length, 1);
});

test('el porcentaje de comisión no es fijo entre ventas', () => {
  const csv = [
    HEADER,
    row({ 'N° del orden': 'A', 'Falabella-Id': 'a', '% comisión': '0.10', 'Monto con IVA': '39.9' }),
    row({
      'N° del orden': 'A',
      'Falabella-Id': 'a',
      'Tipo de transacción': 'Cobro por comisión por venta',
      'Monto con IVA': '-3.99',
      '% comisión': '0.10',
    }),
    row({ 'N° del orden': 'B', 'Falabella-Id': 'b', '% comisión': '0.18', 'Monto con IVA': '33.99' }),
    row({
      'N° del orden': 'B',
      'Falabella-Id': 'b',
      'Tipo de transacción': 'Cobro por comisión por venta',
      'Monto con IVA': '-6.12',
      '% comisión': '0.18',
    }),
  ].join('\n');
  const sales = aggregateSettlementSales(parseSettlementCsv(csv).lines);
  const byOrder = Object.fromEntries(sales.map((sale) => [sale.orderId, sale]));
  assert.equal(byOrder.A.commissionRate, 0.1);
  assert.equal(byOrder.B.commissionRate, 0.18);
  const summary = summarizeSettlementSales(sales);
  assert.equal(summary.saleCount, 2);
  assert.ok(summary.commissionRate > 0.1 && summary.commissionRate < 0.18);
});
