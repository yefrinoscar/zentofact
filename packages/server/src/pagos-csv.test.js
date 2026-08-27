import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindCsvHeaders,
  classifyTransactionType,
  lineFingerprint,
  parseMoney,
  parseDateKey,
  parseSettlementCsv,
} from './pagos-csv.js';

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
