import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeSettlementCsv, formatElapsed, importSummary, paymentStatusLabel, saleOverview, settlementMethodLabel, settlementStatusLabel, shortImportFilename, shortProductName, skuLabel, unmatchedReasonLabel, unitsLabel } from './pagos-presentation.ts';

test('el resumen de importación no habla de duplicados cuando reusa el archivo', () => {
  assert.equal(importSummary({ reused: true, matchedCount: 3, unmatchedCount: 1 }), 'Este archivo ya estaba cargado.');
  assert.equal(importSummary({ reused: false, matchedCount: 2, unmatchedCount: 3, paidSalesCount: 1 }), '2 cruzadas · 3 sin cruzar · 1 pagadas');
  assert.equal(shortImportFilename('NewReportTransaction_FAPE-SCDE75A-20260820-PEN.csv'), 'FAPE-SCDE75A-20260820-PEN.csv');
  assert.equal(formatElapsed(14), '1.4s');
  assert.equal(formatElapsed(615), '1m 1.5s');
  assert.equal(unmatchedReasonLabel('unknown_order_id'), 'Pedido no está en las ventas');
  assert.equal(paymentStatusLabel('Pagado'), 'Pagado');
  assert.equal(paymentStatusLabel('No Pagado'), 'No pagado');
});

test('el overview nombra cobro envío y lo que se queda', () => {
  assert.equal(
    saleOverview({ saleCount: 27, commissionRate: 0.14, shippingRate: 0.21, takeRate: 0.35 }),
    '27 ventas · comisión 14% · cobro envío 21% · se queda 35%',
  );
  assert.equal(
    saleOverview({ saleCount: 1, commissionRate: 0.15, shippingRate: 0.434, takeRate: 0.584 }),
    '1 venta · comisión 15% · cobro envío 43.4% · se queda 58.4%',
  );
});

test('acorta el título de plaza y deja SKU e unidades aparte', () => {
  assert.equal(
    shortProductName('Manta Térmica Aluminizada Mylar Emergencia Trekking Camping'),
    'Manta Térmica Aluminizada',
  );
  assert.equal(skuLabel(['MTC12367890']), 'MTC12367890');
  assert.equal(skuLabel(['MTC12367890', 'HOG025']), 'MTC12367890 +1');
  assert.equal(unitsLabel(11), '11 u');
  assert.equal(unitsLabel(1), '');
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
