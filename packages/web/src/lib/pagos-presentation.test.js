import test from 'node:test';
import assert from 'node:assert/strict';
import { CSV_UPLOAD_MIN_MS, PAGOS_COLUMN_COPY, chargeKindLabel, csvReadError, decodeSettlementCsv, documentLabel, formatElapsed, formatLivelineDay, importSummary, livelinePointsFromDays, livelinePointsFromValues, livelineWindowSecs, paymentStatusLabel, remainingHoldMs, repairProductText, reusedImportNotice, saleOverview, salesPageNote, settlementCash, settlementCharts, settlementDailySeries, settlementIndicators, settlementMethodLabel, settlementStatusLabel, settlementTrendPoints, shortImportFilename, shortProductName, skuLabel, unmatchedReasonLabel, unitsLabel } from './pagos-presentation.ts';

test('el resumen de importación no habla de duplicados cuando reusa el archivo', () => {
  assert.equal(importSummary({ reused: true, matchedCount: 3, unmatchedCount: 1 }), 'Este CSV ya está cruzado.');
  assert.equal(
    importSummary({
      reused: true,
      filename: 'NewReportTransaction_FAPE-SCDE75A-20260820-PEN.csv',
      importedAt: '2026-08-27T12:00:00.000Z',
    }),
    'Este CSV ya está cruzado · FAPE-SCDE75A-20260820-PEN.csv · 27 ago.',
  );
  assert.equal(importSummary({ reused: false, matchedCount: 2, unmatchedCount: 3, paidSalesCount: 1 }), '2 cruzadas · 3 sin cruzar · 1 pagadas');
  assert.equal(
    importSummary({ replaced: true, matchedCount: 2, unmatchedCount: 1, paidSalesCount: 1 }),
    'Se volvió a cruzar · 2 cruzadas · 1 sin cruzar · 1 pagadas',
  );
  assert.equal(shortImportFilename('NewReportTransaction_FAPE-SCDE75A-20260820-PEN.csv'), 'FAPE-SCDE75A-20260820-PEN.csv');
  assert.equal(
    shortImportFilename('NewReportTransaction_FAPE-SCDE75A-20260820-PEN_2026-08-27T11_53_11.4043969.csv'),
    'FAPE-SCDE75A-20260820-PEN.csv',
  );
  assert.deepEqual(
    reusedImportNotice({
      filename: 'NewReportTransaction_FAPE-SCDE75A-20260820-PEN_2026-08-27T11_53_11.4043969.csv',
      importedAt: '2026-08-27T12:00:00.000Z',
    }),
    { title: 'Este CSV ya está cruzado.', detail: 'FAPE-SCDE75A-20260820-PEN.csv · 27 ago.' },
  );
  assert.deepEqual(csvReadError('El CSV está vacío.'), {
    title: 'El CSV está vacío.',
    detail: 'Elige un archivo de Falabella.',
  });
  assert.deepEqual(csvReadError('No reconocimos columnas para cruzar ventas. Cabeceras: Foo.'), {
    title: 'No reconocimos columnas para cruzar ventas. Cabeceras: Foo.',
    detail: 'Usa el NewReportTransaction de Falabella.',
  });
  assert.equal(formatElapsed(14), '1.4s');
  assert.equal(formatElapsed(615), '1m 1.5s');
  assert.equal(remainingHoldMs(1000, CSV_UPLOAD_MIN_MS, 1000), 1400);
  assert.equal(remainingHoldMs(1000, CSV_UPLOAD_MIN_MS, 3000), 0);
  assert.equal(unmatchedReasonLabel('unknown_order_id'), 'Pedido no está en las ventas');
  assert.equal(paymentStatusLabel('Pagado'), 'Pagado');
  assert.equal(paymentStatusLabel('No Pagado'), 'No pagado');
});

test('el overview nombra logística y lo que se queda', () => {
  assert.equal(
    saleOverview({ saleCount: 27, commissionRate: 0.14, shippingRate: 0.21, takeRate: 0.35 }),
    '27 ventas · comisión 14% · logística 21% · se queda 35%',
  );
  assert.equal(
    saleOverview({ saleCount: 1, commissionRate: 0.15, shippingRate: 0.434, takeRate: 0.584 }),
    '1 venta · comisión 15% · logística 43.4% · se queda 58.4%',
  );
  assert.equal(
    saleOverview({ saleCount: 27, matchedCount: 20, commissionRate: 0.14, shippingRate: 0.21, takeRate: 0.35 }),
    '27 ventas · 20 cruzadas · comisión 14% · logística 21% · se queda 35%',
  );
  assert.equal(chargeKindLabel('shipping'), 'Logística');
  assert.equal(chargeKindLabel('buyer_shipping'), 'Envío del comprador');
});

test('acorta el título de plaza y deja SKU e unidades aparte', () => {
  assert.equal(
    shortProductName('Manta Térmica Aluminizada Mylar Emergencia Trekking Camping'),
    'Manta Térmica Aluminizada',
  );
  assert.equal(repairProductText('Manta TÃ©rmica'), 'Manta Térmica');
  assert.equal(shortProductName('Manta TÃ©rmica Aluminizada Mylar'), 'Manta Térmica Aluminizada');
  assert.equal(skuLabel(['MTC12367890']), 'MTC12367890');
  assert.equal(skuLabel(['MTC12367890', 'HOG025']), 'MTC12367890 +1');
  assert.equal(unitsLabel(11), '11 u');
  assert.equal(unitsLabel(1), '');
});

test('el popover nombra boleta, factura o la ausencia', () => {
  assert.equal(documentLabel({ kind: 'boleta', number: 'B001-12' }), 'Boleta B001-12');
  assert.equal(documentLabel({ kind: 'factura', number: 'F001-3' }), 'Factura F001-3');
  assert.equal(documentLabel(null), 'Sin boleta ni factura');
});

test('la caja del dashboard separa vendido, lo que llega y lo pagado', () => {
  assert.deepEqual(
    settlementCash({
      bruto: 100,
      neto: 50,
      take: 50,
      paidNeto: 30,
      pendingNeto: 20,
      paidCount: 2,
      pendingCount: 1,
    }),
    { sold: 100, arrives: 50, kept: 50, paid: 30, pending: 20, paidCount: 2, pendingCount: 1 },
  );
  const kpis = settlementIndicators({
    saleCount: 27,
    bruto: 1739.2,
    neto: 1218.35,
    take: 520.85,
    paidNeto: 381.96,
    pendingNeto: 836.39,
    paidCount: 11,
    pendingCount: 16,
    takeRate: 0.299,
    ticket: 64.41,
    itemCount: 45,
    matchedCount: 27,
  });
  assert.deepEqual(kpis.map((kpi) => kpi.id), ['sold', 'arrives', 'kept', 'paid', 'pending', 'ticket']);
  assert.equal(kpis[0].label, 'Facturado');
  assert.equal(kpis[0].hint, '27 ventas');
  assert.equal(kpis[2].hint, '29.9%');
  assert.equal(kpis[3].hint, '11 ventas');
  assert.equal(kpis[4].hint, '16 ventas');
  assert.equal(kpis[5].hint, '45 u');
  assert.equal(
    settlementIndicators({ saleCount: 27, matchedCount: 20, bruto: 100, neto: 70 })[0].hint,
    '27 ventas · 20 cruzadas',
  );
});

test('los charts de Pagos usan facturado, neto, cobros y depósito', () => {
  const charts = settlementCharts({
    saleCount: 27,
    bruto: 1739.2,
    neto: 1218.35,
    take: 520.85,
    commission: 148.2,
    shipping: 372.65,
    paidNeto: 381.96,
    pendingNeto: 836.39,
    paidCount: 11,
    pendingCount: 16,
    takeRate: 0.299,
    matchedCount: 27,
  });
  assert.deepEqual(charts.map((chart) => chart.id), ['billed', 'fees', 'payout']);
  assert.deepEqual(charts.map((chart) => chart.kind), ['compare', 'together', 'ring']);
  assert.deepEqual(
    charts.flatMap((chart) => chart.items.map((item) => item.label)),
    ['Facturado', 'Neto', 'Comisión', 'Logística', 'Se queda', 'Pagado', 'Pendiente'],
  );
  assert.equal(charts[0].items[0].value, 1739.2);
  assert.equal(charts[0].items[1].value, 1218.35);
  assert.equal(charts[1].items[0].value, 148.2);
  assert.equal(charts[1].items[1].value, 372.65);
  assert.equal(charts[1].items[2].value, 520.85);
  assert.equal(charts[2].items[0].value, 381.96);
  assert.equal(charts[2].items[1].value, 836.39);
  assert.equal(charts[0].hint, '27 ventas');
  assert.equal(charts[1].hint, '29.9% se queda');
  assert.equal(charts[2].hint, '11 pagadas · 16 pendientes');
  assert.equal(
    settlementCharts({ saleCount: 27, matchedCount: 20, bruto: 100, neto: 70 })[0].hint,
    '27 ventas · 20 cruzadas',
  );
  assert.ok(!charts.some((chart) => /precio|ticket/i.test(`${chart.hint} ${chart.items.map((item) => item.label).join(' ')}`)));
});

test('el trend diario agrupa facturado, neto y depósito', () => {
  const days = settlementDailySeries([
    { date: '2026-08-19', paid: true, bruto: 98.89, neto: 41.14, commission: 14.85, shipping: 42.9 },
    { date: '2026-08-19', paid: true, bruto: 33.99, neto: 16.97, commission: 6.12, shipping: 10.9 },
    { date: '2026-08-23', paid: false, bruto: 33.99, neto: 16.97, commission: 6.12, shipping: 10.9 },
  ]);
  assert.equal(days.length, 2);
  assert.equal(days[0].date, '2026-08-19');
  assert.equal(days[0].facturado, 132.88);
  assert.equal(days[0].neto, 58.11);
  assert.equal(days[0].paid, 58.11);
  assert.equal(days[0].pending, 0);
  assert.equal(days[0].take, 74.77);
  assert.equal(days[1].pending, 16.97);
  const points = settlementTrendPoints(days, ['facturado', 'neto']);
  assert.ok(points.length > 2);
  assert.equal(points[0].facturado, 132.88);
  assert.equal(points.at(-1).neto, 16.97);
  const line = livelinePointsFromValues([132.88, 16.97]);
  assert.ok(line.length > 2);
  assert.equal(line[0].value, 132.88);
  assert.equal(line.at(-1).value, 16.97);
  assert.ok(line[0].time < line.at(-1).time);
  const byDay = livelinePointsFromDays(days, 'take');
  assert.equal(byDay[0].value, 74.77);
  assert.equal(byDay.at(-1).value, 17.02);
  assert.ok(livelineWindowSecs(byDay) >= 86400);
  assert.match(formatLivelineDay(byDay[0].time), /ago|set|ene|feb|mar|abr|may|jun|jul|oct|nov|dic/i);
});

test('decodifica un CSV Falabella en Windows-1252 cuando UTF-8 queda ilegible', () => {
  const header = 'Fecha creación de la orden,N° del orden,Estado de pago,Monto con IVA';
  const bytes = Uint8Array.from(Buffer.from(header, 'latin1'));
  const decoded = decodeSettlementCsv(bytes);
  assert.match(decoded, /creación/);
  assert.match(decoded, /Estado de pago/);
});

test('las cabeceras de dinero caben en título y una explicación', () => {
  for (const column of Object.values(PAGOS_COLUMN_COPY)) {
    assert.equal(column.label.split(/\s+/).length <= 2, true, column.label);
    assert.equal(column.hint.split(/\s+/).length <= 4, true, column.hint);
    assert.equal(column.hint.includes('\n'), false);
  }
  assert.equal(PAGOS_COLUMN_COPY.neto.hint, 'Te depositan');
  assert.equal(PAGOS_COLUMN_COPY.take.hint, 'Comisión + logística');
  assert.equal(salesPageNote(27, 27), '27 ventas');
  assert.equal(salesPageNote(1, 1), '1 venta');
  assert.equal(salesPageNote(2000, 5432), 'Mostrando 2000 de 5432. Afina la búsqueda.');
});

test('el cruce se nombra como en la mesa', () => {
  assert.equal(settlementStatusLabel('matched'), 'Cruzada');
  assert.equal(settlementStatusLabel('unmatched'), 'Sin cruzar');
  assert.equal(settlementMethodLabel('order_id'), 'ID de orden');
  assert.equal(unmatchedReasonLabel('ambiguous_order_id'), 'Varias ventas con el mismo pedido');
  assert.equal(unmatchedReasonLabel('no_unique_match'), 'Sin match único');
});
