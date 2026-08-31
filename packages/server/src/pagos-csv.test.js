import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  bindCsvHeaders,
  classifyChargeKind,
  classifyTransactionType,
  lineFingerprint,
  parseMoney,
  parseDateKey,
  parsePaymentStatus,
  parseSettlementCsv,
  repairSettlementText,
} from './pagos-csv.js';

const NEW_REPORT_HEADERS = [
  'Fecha creación de la orden',
  'Nombre del producto',
  'N° del orden',
  'SKU vendedor',
  'SKU Falabella',
  'Id Artículo',
  'Falabella-Id',
  'Estado de la orden',
  'Fecha de Entrega',
  'Tipo de transacción',
  'Fecha de transacción',
  'Divisa',
  'Monto (Sin IVA)',
  'IVA',
  'Monto con IVA',
  'Tipo de comisión',
  '% comisión',
  'Talla',
  'Opscore',
  'Estado de pago',
  'N° estado de cuenta',
  'Referencia de pago Fpay',
  'Comentarios',
  'Tipo de envío',
  'Proveedor logístico',
  'Modalidad logística',
  'Seller ID',
  'Tipo de Seller',
  'Tipo de Documento Tributario',
  'N° Documento Tributario',
  'Categoría de transacciones',
];

function newReportRow(overrides = {}) {
  const values = {
    'Fecha creación de la orden': '2026-08-19 09:25:12',
    'Nombre del producto': 'Manta térmica',
    'N° del orden': '3248910865',
    'SKU vendedor': 'MTC12367890',
    'SKU Falabella': '135888977',
    'Id Artículo': '57583596',
    'Falabella-Id': '53afee02-98f2-41f6-b488-da4f68e19f09',
    'Estado de la orden': 'entregada',
    'Fecha de Entrega': '2026-08-20 11:17:05',
    'Tipo de transacción': 'Pago por precio del producto',
    'Fecha de transacción': '2026-08-20',
    Divisa: 'PEN',
    'Monto (Sin IVA)': '7.62',
    IVA: '1.37',
    'Monto con IVA': '8.99',
    'Tipo de comisión': '',
    '% comisión': '',
    Talla: 'XS2',
    Opscore: '5',
    'Estado de pago': 'Pagado',
    'N° estado de cuenta': 'FAPE-SCDE75A-20260820-PEN',
    'Referencia de pago Fpay': '00000000000000000353034616',
    Comentarios: 'Programado para procesamiento',
    'Tipo de envío': 'drop_shipping',
    'Proveedor logístico': 'falabella',
    'Modalidad logística': 'FBS',
    'Seller ID': 'SCDE75A',
    'Tipo de Seller': 'Principal',
    'Tipo de Documento Tributario': 'n/a',
    'N° Documento Tributario': 'n/a',
    'Categoría de transacciones': 'Precio Producto',
    ...overrides,
  };
  return NEW_REPORT_HEADERS.map((header) => `"${String(values[header] ?? '').replaceAll('"', '""')}"`).join(',');
}

function newReportCsv(rows) {
  return [`${NEW_REPORT_HEADERS.map((header) => `"${header}"`).join(',')}`, ...rows.map(newReportRow)].join('\n');
}

test('lee montos con coma decimal y signo negativo', () => {
  assert.equal(parseMoney('1.234,50'), 1234.5);
  assert.equal(parseMoney('-12,30'), -12.3);
  assert.equal(parseMoney('S/ 189.90'), 189.9);
  assert.equal(parseMoney('(15.00)'), -15);
});

test('lee fechas de corte latinoamericanas', () => {
  assert.equal(parseDateKey('27/08/2026'), '2026-08-27');
  assert.equal(parseDateKey('2026-08-27 13:00:00'), '2026-08-27');
});

test('reconoce cabeceras de estado de cuenta Falabella Seller Center', () => {
  const binding = bindCsvHeaders([
    'Fecha de transacción',
    'Tipo de transacción',
    'N.° de pedido',
    'SKU del vendedor',
    'Monto',
  ]);
  assert.equal(binding.shape, 'transaction_rows');
  assert.equal(binding.columns.orderId, 'N.° de pedido');
  assert.equal(binding.columns.sku, 'SKU del vendedor');
  assert.equal(binding.columns.amount, 'Monto');
  assert.equal(binding.columns.type, 'Tipo de transacción');
});

test('reconoce cabeceras de liquidación con bruto comisión y neto', () => {
  const binding = bindCsvHeaders([
    'ID Pedido',
    'Fecha de liquidación',
    'SKU',
    'Monto pedido',
    'Monto comisión',
    'Monto flete',
    'Monto total a depositar',
  ]);
  assert.equal(binding.shape, 'settlement_columns');
  assert.equal(binding.columns.orderId, 'ID Pedido');
  assert.equal(binding.columns.bruto, 'Monto pedido');
  assert.equal(binding.columns.commission, 'Monto comisión');
  assert.equal(binding.columns.other, 'Monto flete');
  assert.equal(binding.columns.neto, 'Monto total a depositar');
});

test('reconoce el NewReportTransaction de Falabella Seller Center Perú', () => {
  const binding = bindCsvHeaders(NEW_REPORT_HEADERS);
  assert.equal(binding.shape, 'transaction_rows');
  assert.equal(binding.columns.orderId, 'N° del orden');
  assert.equal(binding.columns.sku, 'SKU vendedor');
  assert.equal(binding.columns.shopSku, 'SKU Falabella');
  assert.equal(binding.columns.itemId, 'Falabella-Id');
  assert.equal(binding.columns.amount, 'Monto con IVA');
  assert.equal(binding.columns.paymentStatus, 'Estado de pago');
  assert.equal(binding.columns.orderDate, 'Fecha creación de la orden');
  assert.equal(binding.columns.commission, null);
  assert.equal(binding.columns.commissionRate, '% comisión');
});

test('reconoce Nº de orden del Excel NewReportTransaction', () => {
  const binding = bindCsvHeaders([
    'Fecha creación de la orden',
    'Nombre del producto',
    'Nº de orden',
    'SKU vendedor',
    'Estado de pago',
    'Monto con IVA',
    'Tipo de transacción',
  ]);
  assert.equal(binding.columns.orderId, 'Nº de orden');
  assert.equal(binding.columns.productName, 'Nombre del producto');
});

test('salta el preámbulo del Excel exportado a CSV', () => {
  const csv = [
    'Fecha de actualización,31/08/26 12:49',
    '',
    'Este reporte podría tener cambios hasta el cierre del período de facturación',
    '',
    'Información de la orden,,,,,,,,,Información Transacción',
    '"Fecha creación de la orden","Nombre del producto","Nº de orden","SKU vendedor","Estado de pago","Monto con IVA","Tipo de transacción"',
    '"2026-08-28 11:09:54","Mochila de camping trekking 40L - Resistente y Ergonómico","3249878585","13457","No Pagado","54.99","Pago por precio del producto"',
  ].join('\n');
  const parsed = parseSettlementCsv(csv);
  assert.equal(parsed.lines.length, 1);
  assert.equal(parsed.lines[0].orderId, '3249878585');
  assert.equal(parsed.lines[0].productName, 'Mochila de camping trekking 40L - Resistente y Ergonómico');
  assert.equal(parsed.lines[0].amount, 54.99);
});

test('rechaza un CSV sin columnas para cruzar y cita las cabeceras reales', () => {
  assert.throws(
    () => bindCsvHeaders(['Nombre', 'Comentario']),
    /Nombre, Comentario/,
  );
});

test('clasifica venta comisión y otros cobros', () => {
  assert.equal(classifyTransactionType('Sales'), 'sale');
  assert.equal(classifyTransactionType('Comisión'), 'commission');
  assert.equal(classifyTransactionType('Shipping Fee'), 'other');
  assert.equal(classifyTransactionType('Pago por precio del producto'), 'sale');
  assert.equal(classifyTransactionType('Cobro por comisión por venta'), 'commission');
  assert.equal(classifyTransactionType('Cobro por cofinanciamiento logístico'), 'other');
  assert.equal(classifyTransactionType('Pago de envío comprador'), 'other');
  assert.equal(classifyTransactionType('Reversa de pago de envío comprador'), 'other');
  assert.equal(classifyChargeKind('Pago de envío comprador'), 'buyer_shipping');
  assert.equal(classifyChargeKind('Reversa de pago de envío comprador'), 'buyer_shipping');
  assert.equal(classifyChargeKind('Pago de env√≠o comprador'), 'buyer_shipping');
  assert.equal(classifyChargeKind('Reversa de pago de env√≠o comprador'), 'buyer_shipping');
  assert.equal(classifyChargeKind('Cobro por cofinanciamiento log√≠stico'), 'shipping');
  assert.equal(repairSettlementText('Cobro por comisi√≥n por venta'), 'Cobro por comisión por venta');
  assert.equal(parsePaymentStatus('Pagado'), true);
  assert.equal(parsePaymentStatus('No Pagado'), false);
});

test('parsea un estado de cuenta y no duplica la huella al reimportar la misma línea', () => {
  const csv = [
    'Fecha de transacción;Tipo de transacción;N.° de pedido;SKU del vendedor;Monto',
    '27/08/2026;Sales;PV-10002;AG301;189.90',
    '27/08/2026;Commission;PV-10002;AG301;-28.49',
    '27/08/2026;Shipping Fee;PV-10002;AG301;-5.00',
  ].join('\n');
  const parsed = parseSettlementCsv(csv);
  assert.equal(parsed.lines.length, 3);
  assert.equal(parsed.lines[0].orderId, 'PV-10002');
  assert.equal(parsed.lines[0].sku, 'AG301');
  assert.equal(parsed.lines[0].bruto, 189.9);
  assert.equal(parsed.lines[1].commission, 28.49);
  assert.equal(parsed.lines[2].other, 5);
  assert.equal(parsed.lines[0].kind, 'sale');
  const first = lineFingerprint(parsed.lines[0]);
  const again = parseSettlementCsv(csv);
  assert.equal(lineFingerprint(again.lines[0]), first);
});

test('parsea líneas item-level del NewReportTransaction y usa la fecha de la orden', () => {
  const csv = newReportCsv([
    {},
    {
      'Tipo de transacción': 'Cobro por comisión por venta',
      'Monto (Sin IVA)': '-1.14',
      IVA: '-0.21',
      'Monto con IVA': '-1.35',
      'Categoría de transacciones': 'Comisiones',
      '% comisión': '0.15',
      'Tipo de comisión': 'commissionseller',
    },
    {
      'Estado de pago': 'No Pagado',
      'N° estado de cuenta': 'FAPE-SCDE75A-20260826-PEN',
      'Referencia de pago Fpay': '',
      'Falabella-Id': 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    },
  ]);
  const parsed = parseSettlementCsv(csv);
  assert.equal(parsed.lines.length, 3);
  assert.equal(parsed.lines[0].orderId, '3248910865');
  assert.equal(parsed.lines[0].sku, 'MTC12367890');
  assert.equal(parsed.lines[0].itemId, '53afee02-98f2-41f6-b488-da4f68e19f09');
  assert.equal(parsed.lines[0].date, '2026-08-19');
  assert.equal(parsed.lines[0].kind, 'sale');
  assert.equal(parsed.lines[0].paid, true);
  assert.equal(parsed.lines[0].bruto, 8.99);
  assert.equal(parsed.lines[1].kind, 'commission');
  assert.equal(parsed.lines[1].commission, 1.35);
  assert.equal(parsed.lines[2].paid, false);
  assert.equal(new Set(parsed.lines.map(lineFingerprint)).size, 3);
});

test('el envío del comprador no se guarda como cobro aunque sume y reste', () => {
  const csv = newReportCsv([
    {},
    {
      'Tipo de transacción': 'Pago de env√≠o comprador',
      'Monto (Sin IVA)': '2.69',
      IVA: '0.48',
      'Monto con IVA': '3.17',
      'Categoría de transacciones': 'Envío',
    },
    {
      'Tipo de transacción': 'Reversa de pago de envío comprador',
      'Monto (Sin IVA)': '-2.69',
      IVA: '-0.48',
      'Monto con IVA': '-3.17',
      'Categoría de transacciones': 'Envío',
    },
    {
      'Tipo de transacción': 'Cobro por cofinanciamiento logístico',
      'Monto (Sin IVA)': '-3.31',
      IVA: '-0.59',
      'Monto con IVA': '-3.9',
      'Categoría de transacciones': 'Logística',
    },
  ]);
  const lines = parseSettlementCsv(csv).lines;
  const pago = lines.find((line) => line.chargeKind === 'buyer_shipping' && Number(line.neto) > 0);
  const reversa = lines.find((line) => line.chargeKind === 'buyer_shipping' && Number(line.neto) < 0);
  const logistica = lines.find((line) => line.chargeKind === 'shipping');
  assert.equal(pago.other, 0);
  assert.equal(reversa.other, 0);
  assert.equal(pago.neto, 3.17);
  assert.equal(reversa.neto, -3.17);
  assert.equal(logistica.other, 3.9);
  assert.equal(logistica.neto, -3.9);
});

const REAL_PAID = '/home/ubuntu/.cursor/projects/workspace/uploads/NewReportTransaction_FAPE-SCDE75A-20260820-PEN_2026-08-27T11_53_11.404396991_1629.csv';
const REAL_UNPAID = '/home/ubuntu/.cursor/projects/workspace/uploads/NewReportTransaction_FAPE-SCDE75A-20260826-PEN_2026-08-27T11_52_00.352526960_dc52.csv';

if (existsSync(REAL_PAID) && existsSync(REAL_UNPAID)) {
  test('lee los NewReportTransaction reales de Falabella Seller Center', () => {
    const paid = parseSettlementCsv(readFileSync(REAL_PAID, 'utf8'));
    const unpaid = parseSettlementCsv(readFileSync(REAL_UNPAID, 'utf8'));
    assert.equal(paid.lines.length, 102);
    assert.equal(unpaid.lines.length, 75);
    assert.equal(paid.lines.filter((line) => line.paid === true).length, 102);
    assert.equal(unpaid.lines.filter((line) => line.paid === false).length, 75);
    assert.equal(paid.lines.filter((line) => line.kind === 'sale').length, 26);
    assert.equal(unpaid.lines.filter((line) => line.kind === 'sale').length, 19);
    assert.equal(paid.lines[0].orderId, '3248910865');
    assert.equal(unpaid.lines[0].orderId, '3249508491');
    assert.equal(new Set(paid.lines.map(lineFingerprint)).size, 102);
    assert.equal(new Set(unpaid.lines.map(lineFingerprint)).size, 75);
    assert.equal(paid.binding.columns.amount, 'Monto con IVA');
    assert.equal(paid.binding.columns.orderId.includes('del orden'), true);
  });
}
