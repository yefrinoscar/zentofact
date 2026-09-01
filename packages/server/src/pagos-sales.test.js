import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSettlementCsv } from './pagos-csv.js';
import { aggregateSettlementSales, attachDocumentsToSales, attachOrderShippingToSales, chooseLinesPerOrder, filterAggregatedSales, groupSaleCharges, groupSaleProducts, settlementMonthOptions, summarizeSettlementSales } from './pagos-sales.js';

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
  assert.equal(sale.other, 0);
  assert.equal(sale.neto, 3.74);
  assert.equal(sale.neto, Math.round((sale.bruto - sale.commission - sale.shipping) * 100) / 100);
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
  assert.equal(parsed.lines.filter((line) => line.chargeKind === 'buyer_shipping').every((line) => line.other === 0), true);
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

test('el duplicado se resuelve por pedido: un CSV, no se mezclan archivos', () => {
  const once = Array.from({ length: 11 }, (_, index) => unitLines(`item-${index + 1}`)).flat();
  const csv = [HEADER, ...once].join('\n');
  const older = parseSettlementCsv(csv).lines.map((line) => ({ ...line, importId: 6 }));
  const newer = parseSettlementCsv(csv).lines.map((line) => ({ ...line, importId: 9 }));
  const leftover = parseSettlementCsv([
    HEADER,
    row({
      'Falabella-Id': 'item-1',
      'Tipo de transacción': 'Cobro por cofinanciamiento logístico',
      'Monto con IVA': '-3.9',
    }),
  ].join('\n')).lines.map((line) => ({ ...line, importId: 10 }));
  const [sale] = aggregateSettlementSales([...older, ...newer, ...leftover]);
  assert.equal(chooseLinesPerOrder([...older, ...newer, ...leftover]).every((line) => line.importId === 9), true);
  assert.equal(sale.itemCount, 11);
  assert.equal(sale.bruto, 98.89);
  assert.equal(sale.commission, 14.85);
  assert.equal(sale.shipping, 42.9);
  assert.equal(sale.take, 57.75);
  assert.equal(sale.neto, 41.14);
  assert.equal(sale.buyerShipping, 0);
  assert.equal(sale.buyerShippingPaid, 34.87);
  assert.equal(sale.buyerShippingReversed, -34.87);
  const byKind = Object.fromEntries(sale.chargeGroups.map((group) => [group.kind, group]));
  assert.equal(byKind.commission.count, 11);
  assert.equal(byKind.shipping.count, 11);
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
  assert.equal(summary.saleCount, 2);
  assert.equal(summary.itemCount, 2);
  assert.equal(summary.ticket, 14.5);
});

test('Programado no queda pagado y el tag corto se arma desde el estado', () => {
  const csv = [
    HEADER,
    row({ 'Estado de pago': 'Programado para 20/08/2026' }),
    row({
      'Tipo de transacción': 'Cobro por comisión por venta',
      'Monto con IVA': '-1.35',
      'Estado de pago': 'Programado para 20/08/2026',
    }),
  ].join('\n');
  const [sale] = aggregateSettlementSales(parseSettlementCsv(csv).lines);
  assert.equal(sale.paid, false);
  assert.equal(sale.paymentStatus, 'Programado para 20/08/2026');
});

test('si comisión y logística superan el precio, te llega queda en pérdida', () => {
  const csv = [
    HEADER,
    row({ 'Monto con IVA': '99.90' }),
    row({ 'Tipo de transacción': 'Cobro por comisión por venta', 'Monto con IVA': '-29.98' }),
    row({ 'Tipo de transacción': 'Cobro por cofinanciamiento logístico', 'Monto con IVA': '-80.82' }),
  ].join('\n');
  const [sale] = aggregateSettlementSales(parseSettlementCsv(csv).lines);
  assert.equal(sale.bruto, 99.9);
  assert.equal(sale.commission, 29.98);
  assert.equal(sale.shipping, 80.82);
  assert.equal(sale.take, 110.8);
  assert.equal(sale.neto, -10.9);
  assert.equal(sale.returned, false);
});

function assertReturnLegs(sale) {
  assert.equal(sale.brutoCharged, 99.9);
  assert.equal(sale.brutoReversed, -99.9);
  assert.equal(sale.commissionCharged, 29.98);
  assert.equal(sale.commissionReversed, -29.98);
  assert.equal(sale.shippingCharged, 80.82);
  assert.equal(sale.shippingReversed, 0);
}

test('una devolución descuenta el producto, devuelve la comisión y deja la logística', () => {
  const csv = [
    HEADER,
    row({ 'Monto con IVA': '99.90' }),
    row({ 'Tipo de transacción': 'Cobro por comisión por venta', 'Monto con IVA': '-29.98' }),
    row({ 'Tipo de transacción': 'Cobro por cofinanciamiento logístico', 'Monto con IVA': '-80.82' }),
    row({ 'Monto con IVA': '-99.90' }),
    row({ 'Tipo de transacción': 'Cobro por comisión por venta', 'Monto con IVA': '29.98' }),
  ].join('\n');
  const [sale] = aggregateSettlementSales(parseSettlementCsv(csv).lines);
  assert.equal(sale.returned, true);
  assert.equal(sale.bruto, 0);
  assert.equal(sale.commission, 0);
  assert.equal(sale.shipping, 80.82);
  assert.equal(sale.neto, -80.82);
  assertReturnLegs(sale);
});

test('un archivo solo con la reversa no se pinta como venta nueva', () => {
  const csv = [
    HEADER,
    row({ 'Monto con IVA': '-99.90' }),
    row({ 'Tipo de transacción': 'Cobro por comisión por venta', 'Monto con IVA': '29.98' }),
  ].join('\n');
  const [sale] = aggregateSettlementSales(parseSettlementCsv(csv).lines);
  assert.equal(sale.returned, true);
  assert.equal(sale.bruto, -99.9);
  assert.equal(sale.commission, -29.98);
  assert.equal(sale.neto, -69.92);
  assert.equal(sale.brutoCharged, 0);
  assert.equal(sale.brutoReversed, -99.9);
  assert.equal(sale.commissionCharged, 0);
  assert.equal(sale.commissionReversed, -29.98);
});

test('la reversa de otro archivo se junta con la venta ya pagada', () => {
  const sold = parseSettlementCsv([
    HEADER,
    row({
      'Fecha creación de la orden': '2026-08-19 09:25:12',
      'Monto con IVA': '99.90',
    }),
    row({
      'Fecha creación de la orden': '2026-08-19 09:25:12',
      'Tipo de transacción': 'Cobro por comisión por venta',
      'Monto con IVA': '-29.98',
    }),
    row({
      'Fecha creación de la orden': '2026-08-19 09:25:12',
      'Tipo de transacción': 'Cobro por cofinanciamiento logístico',
      'Monto con IVA': '-80.82',
    }),
  ].join('\n')).lines.map((line) => ({ ...line, importId: 1 }));
  const returned = parseSettlementCsv([
    HEADER,
    row({
      'Fecha creación de la orden': '2026-08-26 11:02:00',
      'Monto con IVA': '-99.90',
    }),
    row({
      'Fecha creación de la orden': '2026-08-26 11:02:00',
      'Tipo de transacción': 'Cobro por comisión por venta',
      'Monto con IVA': '29.98',
    }),
  ].join('\n')).lines.map((line) => ({ ...line, importId: 2 }));
  const [sale] = aggregateSettlementSales([...sold, ...returned]);
  assert.equal(sale.returned, true);
  assert.equal(sale.bruto, 0);
  assert.equal(sale.commission, 0);
  assert.equal(sale.shipping, 80.82);
  assert.equal(sale.take, 80.82);
  assert.equal(sale.neto, -80.82);
  assertReturnLegs(sale);
});

test('guarda la fecha de la orden y la del pago, y filtra por mes', () => {
  const header = [
    '"Fecha creación de la orden"',
    '"Nombre del producto"',
    '"N° del orden"',
    '"SKU vendedor"',
    '"SKU Falabella"',
    '"Falabella-Id"',
    '"Tipo de transacción"',
    '"Fecha de transacción"',
    '"Monto con IVA"',
    '"Estado de pago"',
  ].join(',');
  const line = (orderId, sku, itemId, date, tx, amount, status, type = 'Pago por precio del producto') => [
    `"${date}"`,
    '"Funda"',
    `"${orderId}"`,
    `"${sku}"`,
    '"135"',
    `"${itemId}"`,
    `"${type}"`,
    `"${tx}"`,
    `"${amount}"`,
    `"${status}"`,
  ].join(',');
  const sales = aggregateSettlementSales(parseSettlementCsv([
    header,
    line('3243000099', 'ADC9000100', 'item-a', '2026-08-19 09:25:12', '2026-08-20', '100.00', 'Pagado'),
    line('3243000099', 'ADC9000100', 'item-a', '2026-08-19 09:25:12', '2026-08-20', '-10.00', 'Pagado', 'Cobro por comisión por venta'),
    line('3243000100', 'ADC9000101', 'item-b', '2026-07-03 10:00:00', '2026-07-10', '80.00', 'Pagado'),
    line('3243000101', 'ADC9000102', 'item-c', '2026-08-12 09:00:00', '', '80.00', 'No Pagado'),
    line('3243000102', 'ADC9000103', 'item-d', '2026-08-15 09:00:00', '', '90.00', 'Programado para 05/09/2026'),
  ].join('\n')).lines);
  const byId = Object.fromEntries(sales.map((sale) => [sale.orderId, sale]));
  assert.equal(byId['3243000099'].date, '2026-08-19');
  assert.equal(byId['3243000099'].paidDate, '2026-08-20');
  assert.equal(byId['3243000101'].paidDate, null);
  assert.equal(byId['3243000102'].paidDate, '2026-09-05');
  assert.deepEqual(settlementMonthOptions(sales), {
    orderMonths: ['2026-08', '2026-07'],
    paidMonths: ['2026-09', '2026-08', '2026-07'],
  });
  assert.deepEqual(
    filterAggregatedSales(sales, { orderMonth: '2026-08' }).map((sale) => sale.orderId).sort(),
    ['3243000099', '3243000101', '3243000102'],
  );
  assert.deepEqual(
    filterAggregatedSales(sales, { paidMonth: '2026-08' }).map((sale) => sale.orderId),
    ['3243000099'],
  );
});

test('filtra por compañía y deja todas si no hay filtro', () => {
  const csv = [
    HEADER,
    row({ 'N° del orden': '3243001001', 'SKU vendedor': 'LIMBO-1', 'Monto con IVA': '10.00' }),
    row({ 'N° del orden': '3243001002', 'SKU vendedor': 'MANTA-1', 'Monto con IVA': '20.00' }),
  ].join('\n');
  const [first, second] = parseSettlementCsv(csv).lines;
  const sales = aggregateSettlementSales([
    { ...first, companyId: 1 },
    { ...second, companyId: 2 },
  ]);
  assert.equal(sales.find((sale) => sale.orderId === '3243001001')?.companyId, 1);
  assert.equal(sales.find((sale) => sale.orderId === '3243001002')?.companyId, 2);
  assert.deepEqual(filterAggregatedSales(sales, { companyId: 1 }).map((sale) => sale.orderId), ['3243001001']);
  assert.equal(filterAggregatedSales(sales, {}).length, 2);
});

test('la reversa de otra semana no cambia la fecha del pago original', () => {
  const header = [
    '"Fecha creación de la orden"',
    '"Nombre del producto"',
    '"N° del orden"',
    '"SKU vendedor"',
    '"SKU Falabella"',
    '"Falabella-Id"',
    '"Tipo de transacción"',
    '"Fecha de transacción"',
    '"Monto con IVA"',
    '"Estado de pago"',
  ].join(',');
  const sold = parseSettlementCsv([
    header,
    '"2026-08-19 09:25:12","Funda","3248910865","MTC12367890","135","item-1","Pago por precio del producto","2026-08-20","99.90","Pagado"',
    '"2026-08-19 09:25:12","Funda","3248910865","MTC12367890","135","item-1","Cobro por comisión por venta","2026-08-20","-29.98","Pagado"',
    '"2026-08-19 09:25:12","Funda","3248910865","MTC12367890","135","item-1","Cobro por cofinanciamiento logístico","2026-08-20","-80.82","Pagado"',
  ].join('\n')).lines.map((line) => ({ ...line, importId: 1 }));
  const returned = parseSettlementCsv([
    header,
    '"2026-08-19 09:25:12","Funda","3248910865","MTC12367890","135","item-1","Pago por precio del producto","2026-08-26","-99.90","Pagado"',
    '"2026-08-19 09:25:12","Funda","3248910865","MTC12367890","135","item-1","Cobro por comisión por venta","2026-08-26","29.98","Pagado"',
  ].join('\n')).lines.map((line) => ({ ...line, importId: 2 }));
  const [sale] = aggregateSettlementSales([...sold, ...returned]);
  assert.equal(sale.date, '2026-08-19');
  assert.equal(sale.paidDate, '2026-08-20');
  assert.equal(sale.returned, true);
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

test('el envío de Pagos sale de la orden cruzada', () => {
  const [fromColumn] = attachOrderShippingToSales(
    [{ orderId: '3248910865', buyerShippingPaid: 0 }],
    [{ orderId: '3248910865', shippingAmount: 34.9 }],
  );
  assert.equal(fromColumn.orderShipping, 34.9);
  const [fromItems] = attachOrderShippingToSales(
    [{ orderId: '3248953203' }],
    [{ orderNumber: '3248953203', itemRaws: [{ ShippingAmount: '4.95' }, { ShippingFee: '4.95' }] }],
  );
  assert.equal(fromItems.orderShipping, 9.9);
  const [unmatched] = attachOrderShippingToSales([{ orderId: 'no-existe' }], []);
  assert.equal(unmatched.orderShipping, null);
});
