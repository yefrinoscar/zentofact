import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSettlementCsv } from './pagos-csv.js';
import { aggregateSettlementSales, attachDocumentsToSales, groupSaleCharges, groupSaleProducts, summarizeSettlementSales } from './pagos-sales.js';

const HEADER = [
  '"Fecha creación de la orden"',
  '"Nombre del producto"',
  '"N° del orden"',
  '"SKU vendedor"',
  '"SKU Falabella"',
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
    'SKU Falabella': '135888977',
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
    values['SKU Falabella'],
    values['Falabella-Id'],
    values['Tipo de transacción'],
    values['Monto con IVA'],
    values['% comisión'],
    values['Estado de pago'],
  ].map((value) => `"${value}"`).join(',');
}

test('el envío que paga el comprador no aparece ni mueve lo que te llega', () => {
  const csv = [
    HEADER,
    row(),
    row({ 'Tipo de transacción': 'Cobro por comisión por venta', 'Monto con IVA': '-1.35' }),
    row({ 'Tipo de transacción': 'Cobro por cofinanciamiento log√≠stico', 'Monto con IVA': '-3.9' }),
    row({ 'Tipo de transacción': 'Pago de env√≠o comprador', 'Monto con IVA': '3.17' }),
    row({ 'Tipo de transacción': 'Reversa de pago de env√≠o comprador', 'Monto con IVA': '-3.17' }),
  ].join('\n');
  const [sale] = aggregateSettlementSales(parseSettlementCsv(csv).lines);
  assert.equal(sale.bruto, 8.99);
  assert.equal(sale.commission, 1.35);
  assert.equal(sale.shipping, 3.9);
  assert.equal(sale.buyerShipping, 0);
  assert.equal(sale.buyerShippingPaid, 3.17);
  assert.equal(sale.buyerShippingReversed, -3.17);
  assert.equal(sale.neto, 3.74);
  assert.equal(sale.chargeGroups.some((group) => group.kind === 'buyer_shipping'), false);
  assert.equal(sale.chargeGroups.some((group) => /comprador/i.test(group.type)), false);
});

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
  assert.equal(sale.products[0].shopSku, '135888977');
  assert.equal(sale.bruto, 8.99);
  assert.equal(sale.commission, 1.35);
  assert.equal(sale.commissionRate, 0.15);
  assert.equal(sale.shipping, 3.9);
  assert.equal(sale.buyerShipping, 0);
  assert.equal(sale.buyerShippingPaid, 3.17);
  assert.equal(sale.buyerShippingReversed, -3.17);
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
  assert.equal(summary.paidCount, 2);
  assert.equal(summary.paidNeto, summary.neto);
  assert.equal(summary.pendingNeto, 0);
});

function unitLines(itemId, sku = 'MTC12367890', name = 'Manta Térmica Aluminizada Mylar Emergencia Trekking Camping') {
  return [
    row({ 'Falabella-Id': itemId, 'SKU vendedor': sku, 'Nombre del producto': name }),
    row({
      'Falabella-Id': itemId,
      'SKU vendedor': sku,
      'Nombre del producto': name,
      'Tipo de transacción': 'Cobro por comisión por venta',
      'Monto con IVA': '-1.35',
    }),
    row({
      'Falabella-Id': itemId,
      'SKU vendedor': sku,
      'Nombre del producto': name,
      'Tipo de transacción': 'Cobro por cofinanciamiento logístico',
      'Monto con IVA': '-3.9',
    }),
    row({
      'Falabella-Id': itemId,
      'SKU vendedor': sku,
      'Nombre del producto': name,
      'Tipo de transacción': 'Pago de envío comprador',
      'Monto con IVA': '3.17',
    }),
    row({
      'Falabella-Id': itemId,
      'SKU vendedor': sku,
      'Nombre del producto': name,
      'Tipo de transacción': 'Reversa de pago de envío comprador',
      'Monto con IVA': '-3.17',
    }),
  ];
}

test('agrupa unidades iguales en un producto y cobra envío por tipo', () => {
  const csv = [HEADER, ...Array.from({ length: 11 }, (_, index) => unitLines(`item-${index + 1}`)).flat()].join('\n');
  const [sale] = aggregateSettlementSales(parseSettlementCsv(csv).lines);
  assert.equal(sale.itemCount, 11);
  assert.equal(sale.items.length, 11);
  assert.equal(sale.products.length, 1);
  assert.equal(sale.products[0].quantity, 11);
  assert.equal(sale.products[0].sku, 'MTC12367890');
  assert.equal(sale.products[0].unitBruto, 8.99);
  assert.equal(sale.products[0].unitShipping, 3.9);
  assert.equal(sale.products[0].shipping, 42.9);
  assert.equal(sale.bruto, 98.89);
  assert.equal(sale.commission, 14.85);
  assert.equal(sale.shipping, 42.9);
  assert.equal(sale.buyerShippingPaid, 34.87);
  assert.equal(sale.buyerShippingReversed, -34.87);
  assert.equal(sale.neto, 41.14);
  const byKind = Object.fromEntries(sale.chargeGroups.map((group) => [group.kind, group]));
  assert.equal(byKind.sale.count, 11);
  assert.equal(byKind.commission.count, 11);
  assert.equal(byKind.commission.amount, -14.85);
  assert.equal(byKind.shipping.count, 11);
  assert.equal(byKind.shipping.unitAmount, -3.9);
  assert.equal(byKind.buyer_shipping, undefined);
});

test('pedidos mixtos quedan un grupo por SKU y precio', () => {
  const csv = [
    HEADER,
    ...unitLines('a', 'MTC12367890'),
    ...unitLines('b', 'MTC12367890'),
    row({ 'Falabella-Id': 'c', 'SKU vendedor': 'HOG025', 'Nombre del producto': 'Organizador', 'Monto con IVA': '39.9' }),
    row({
      'Falabella-Id': 'c',
      'SKU vendedor': 'HOG025',
      'Nombre del producto': 'Organizador',
      'Tipo de transacción': 'Cobro por comisión por venta',
      'Monto con IVA': '-4.00',
      '% comisión': '0.10',
    }),
    row({
      'Falabella-Id': 'c',
      'SKU vendedor': 'HOG025',
      'Nombre del producto': 'Organizador',
      'Tipo de transacción': 'Cobro por cofinanciamiento logístico',
      'Monto con IVA': '-2.50',
    }),
  ].join('\n');
  const [sale] = aggregateSettlementSales(parseSettlementCsv(csv).lines);
  const products = groupSaleProducts(sale.items);
  assert.equal(products.length, 2);
  const manta = products.find((item) => item.sku === 'MTC12367890');
  const hog = products.find((item) => item.sku === 'HOG025');
  assert.equal(manta.quantity, 2);
  assert.equal(hog.quantity, 1);
  assert.equal(hog.unitShipping, 2.5);
  const charges = groupSaleCharges(sale.charges);
  const shipping = charges.filter((group) => group.kind === 'shipping');
  assert.equal(shipping.length, 1);
  assert.equal(shipping[0].count, 3);
  assert.equal(shipping[0].unitAmount, null);
  assert.equal(shipping[0].amount, -10.3);
  assert.equal(charges.some((group) => group.kind === 'buyer_shipping'), false);
});

test('un envío comprador sin reversa tampoco entra a cobros ni a te llega', () => {
  const csv = [
    HEADER,
    row(),
    row({ 'Tipo de transacción': 'Cobro por comisión por venta', 'Monto con IVA': '-1.35' }),
    row({ 'Tipo de transacción': 'Pago de envío comprador', 'Monto con IVA': '3.17' }),
  ].join('\n');
  const [sale] = aggregateSettlementSales(parseSettlementCsv(csv).lines);
  assert.equal(sale.neto, 7.64);
  assert.equal(sale.buyerShipping, 3.17);
  assert.equal(sale.buyerShippingPaid, 3.17);
  assert.equal(sale.buyerShippingReversed, 0);
  assert.equal(sale.chargeGroups.some((group) => group.kind === 'buyer_shipping'), false);
});

test('separa lo vendido y lo que llega entre pagado y pendiente', () => {
  const csv = [
    HEADER,
    row(),
    row({ 'Tipo de transacción': 'Cobro por comisión por venta', 'Monto con IVA': '-1.35' }),
    row({
      'N° del orden': '3248910999',
      'Falabella-Id': 'pending-1',
      'Estado de pago': 'No Pagado',
      'Monto con IVA': '20',
    }),
    row({
      'N° del orden': '3248910999',
      'Falabella-Id': 'pending-1',
      'Estado de pago': 'No Pagado',
      'Tipo de transacción': 'Cobro por comisión por venta',
      'Monto con IVA': '-3',
    }),
  ].join('\n');
  const summary = summarizeSettlementSales(aggregateSettlementSales(parseSettlementCsv(csv).lines));
  assert.equal(summary.paidCount, 1);
  assert.equal(summary.pendingCount, 1);
  assert.equal(summary.paidBruto, 8.99);
  assert.equal(summary.pendingBruto, 20);
  assert.equal(summary.paidNeto, 7.64);
  assert.equal(summary.pendingNeto, 17);
});

test('el pedido muestra boleta o factura si ya se emitió', () => {
  const [sale] = attachDocumentsToSales(
    [{ orderId: '3248910865', orderNumbers: ['PV-10001'], bruto: 98.89 }],
    [
      { kind: 'boleta', orderNumber: '3248910865', number: 'B001-12', status: 'ACEPTADO' },
      { kind: 'factura', orderNumber: 'PV-10001', number: 'F001-3', status: 'ACEPTADO' },
    ],
  );
  assert.equal(sale.document.kind, 'boleta');
  assert.equal(sale.document.number, 'B001-12');
});
