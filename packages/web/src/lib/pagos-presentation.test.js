import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeSettlementCsv, importSummary, paymentStatusLabel, saleOverview, settlementMethodLabel, settlementStatusLabel, unmatchedReasonLabel } from './pagos-presentation.ts';

test('el resumen de importación no habla de duplicados cuando reusa el archivo', () => {
  assert.equal(importSummary({ reused: true, matchedCount: 3, unmatchedCount: 1 }), 'Este archivo ya estaba cargado.');
  assert.equal(importSummary({ reused: false, matchedCount: 2, unmatchedCount: 3, paidSalesCount: 1 }), '2 cruzadas · 3 sin cruzar · 1 pagadas');
  assert.equal(unmatchedReasonLabel('unknown_order_id'), 'Pedido no está en las ventas');
  assert.equal(paymentStatusLabel('Pagado'), 'Pagado');
  assert.equal(paymentStatusLabel('No Pagado'), 'No pagado');
});

test('el overview nombra comisión envío y lo que se queda Falabella', () => {
  assert.equal(
    saleOverview({ saleCount: 27, commissionRate: 0.14, shippingRate: 0.21, takeRate: 0.35 }),
    '27 ventas · comisión 14% · envío 21% · Falabella se queda 35%',
  );
});

test('decodifica un CSV Falabella en Windows-1252 cuando UTF-8 queda ilegible', () => {
  const header = 'Fecha creación de la orden,N° del orden,Estado de pago,Monto con IVA';
  const bytes = Uint8Array.from(Buffer.from(header, 'latin1'));
  const decoded = decodeSettlementCsv(bytes);
  assert.match(decoded, /creación/);
  assert.match(decoded, /Estado de pago/);
});

test('el cruce se nombra como en la mesa', () => {
  assert.equal(settlementStatusLabel('matched'), 'Cruzada');
  assert.equal(settlementStatusLabel('unmatched'), 'Sin cruzar');
  assert.equal(settlementMethodLabel('order_id'), 'ID de orden');
  assert.equal(unmatchedReasonLabel('ambiguous_order_id'), 'Varias ventas con el mismo pedido');
  assert.equal(unmatchedReasonLabel('no_unique_match'), 'Sin match único');
});
