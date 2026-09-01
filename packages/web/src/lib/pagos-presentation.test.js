import test from 'node:test';
import assert from 'node:assert/strict';
import { CSV_UPLOAD_MIN_MS, PAGOS_COLUMN_COPY, SUCCESS_NOTICE_MS, chargeKindLabel, csvReadError, decodeSettlementCsv, decodeSettlementSpreadsheet, documentLabel, formatElapsed, formatLivelineDay, igvSplit, importSummary, isSettlementSpreadsheet, livelinePointsFromDays, livelinePointsFromValues, livelineWindowSecs, monthLabel, paymentStatusLabel, paymentStatusTone, remainingHoldMs, repairProductText, reusedImportNotice, saleDatesHint, saleIgvStory, saleOverview, salesPageNote, settlementCash, settlementCharts, settlementDailySeries, settlementIndicators, settlementMethodLabel, settlementPair, settlementStatementTotals, settlementStatusLabel, settlementTrendPoints, shortImportFilename, shortProductName, skuLabel, teLlegaHint, unmatchedReasonLabel, unitsLabel, waffleOutOf100 } from './pagos-presentation.ts';

test('el resumen de importación no habla de duplicados cuando reusa el archivo', () => {
  assert.equal(importSummary({ reused: true, matchedCount: 3, unmatchedCount: 1 }), 'Este archivo ya está cruzado.');
  assert.equal(
    importSummary({
      reused: true,
      filename: 'NewReportTransaction_FAPE-SCDE75A-20260820-PEN.csv',
      importedAt: '2026-08-27T12:00:00.000Z',
    }),
    'Este archivo ya está cruzado · FAPE-SCDE75A-20260820-PEN.csv · 27 ago.',
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
    { title: 'Este archivo ya está cruzado.', detail: 'FAPE-SCDE75A-20260820-PEN.csv · 27 ago.' },
  );
  assert.deepEqual(csvReadError('El CSV está vacío.'), {
    title: 'El CSV está vacío.',
    detail: 'Elige un archivo de Falabella.',
  });
  assert.deepEqual(csvReadError('No reconocimos columnas para cruzar ventas. Cabeceras: Foo.'), {
    title: 'No reconocimos columnas para cruzar ventas. Cabeceras: Foo.',
    detail: '',
  });
  assert.equal(SUCCESS_NOTICE_MS, 5000);
  assert.equal(formatElapsed(14), '1.4s');
  assert.equal(formatElapsed(615), '1m 1.5s');
  assert.equal(remainingHoldMs(1000, CSV_UPLOAD_MIN_MS, 1000), 1400);
  assert.equal(remainingHoldMs(1000, CSV_UPLOAD_MIN_MS, 3000), 0);
  assert.equal(unmatchedReasonLabel('unknown_order_id'), 'Pedido no está en las ventas');
  assert.equal(paymentStatusLabel('Pagado'), 'Pagado');
  assert.equal(paymentStatusLabel('No Pagado'), 'No pagado');
  assert.equal(paymentStatusLabel('Programado para 20/08/2026'), 'Programado');
  assert.equal(paymentStatusLabel('Programado para procesamiento'), 'Programado');
  assert.equal(paymentStatusTone('Pagado'), 'paid');
  assert.equal(paymentStatusTone('Programado para 20/08/2026'), 'scheduled');
  assert.equal(paymentStatusTone('No Pagado'), 'unpaid');
  assert.equal(paymentStatusLabel('Pagado', true), 'Devolución');
  assert.equal(paymentStatusTone('Pagado', true), 'returned');
  assert.equal(teLlegaHint({ returned: true, shipping: 80.82, neto: -80.82 }), 'En la devolución suele quedarse la logística.');
  assert.equal(teLlegaHint({ returned: true, shipping: 0, neto: -69.92 }), 'Descontaron el producto y te devolvieron la comisión.');
  assert.deepEqual(igvSplit(150), { gross: 150, net: 127.12, igv: 22.88 });
  assert.deepEqual(igvSplit(70), { gross: 70, net: 59.32, igv: 10.68 });
  assert.deepEqual(igvSplit(100), { gross: 100, net: 84.75, igv: 15.25 });
  assert.deepEqual(igvSplit(20), { gross: 20, net: 16.95, igv: 3.05 });
  const story = saleIgvStory({ bruto: 100, buyerShippingPaid: 50, commission: 20, shipping: 50 });
  assert.equal(story.boleta.gross, 150);
  assert.equal(story.factura.gross, 70);
  assert.equal(story.queda, 67.8);
  assert.equal(story.productNet, 84.75);
  assert.equal(story.commissionNet, 16.95);
  assert.deepEqual(story.commissionSplit, { gross: 20, net: 16.95, igv: 3.05 });
  assert.deepEqual(story.logisticsSplit, { gross: 50, net: 42.37, igv: 7.63 });
  assert.equal(story.shippingAdjust, 0);
  assert.equal(Math.round((story.productNet - story.commissionNet) * 100) / 100, 67.8);
  const mismatch = saleIgvStory({ bruto: 98.89, buyerShippingPaid: 34.9, commission: 14.85, shipping: 42.9 });
  assert.equal(mismatch.queda, 64.44);
  assert.equal(
    Math.round((mismatch.productNet - mismatch.commissionNet + mismatch.shippingAdjust) * 100) / 100,
    mismatch.queda,
  );
  assert.ok(mismatch.shippingAdjust < 0);
  const fromOrder = saleIgvStory({
    bruto: 100,
    buyerShippingPaid: 0,
    orderShipping: 50,
    commission: 20,
    shipping: 50,
  });
  assert.equal(fromOrder.envio, 50);
  assert.equal(fromOrder.boleta.gross, 150);
  assert.equal(fromOrder.queda, 67.8);
  const orderWins = saleIgvStory({
    bruto: 100,
    buyerShippingPaid: 10,
    orderShipping: 50,
    commission: 20,
    shipping: 50,
  });
  assert.equal(orderWins.envio, 50);
  assert.deepEqual(settlementPair(100, -100), { amount: 100, reversal: -100 });
  assert.deepEqual(settlementPair(10, -10), { amount: 10, reversal: -10 });
  assert.deepEqual(settlementPair(50, 0), { amount: 50, reversal: null });
  assert.deepEqual(settlementPair(99.9, 0), { amount: 99.9, reversal: null });
  assert.deepEqual(settlementPair(0, -99.9), { amount: -99.9, reversal: null });
  assert.equal(monthLabel('2026-08'), 'ago. 2026');
  assert.equal(saleDatesHint({ date: '2026-08-19', paidDate: '2026-08-20' }), 'orden 19 ago. · pago 20 ago.');
  assert.equal(saleDatesHint({ date: '2026-08-19' }), 'orden 19 ago.');
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
  assert.deepEqual(charts.map((chart) => chart.kind), ['compare', 'waffle', 'pie']);
  assert.deepEqual(
    charts.flatMap((chart) => chart.items.map((item) => item.label)),
    ['Facturado', 'Neto', 'Comisión', 'Logística', 'Pagado', 'Pendiente'],
  );
  assert.equal(charts[0].items[0].value, 1739.2);
  assert.equal(charts[0].items[1].value, 1218.35);
  assert.equal(charts[1].hero.label, 'Se queda');
  assert.equal(charts[1].hero.value, 520.85);
  assert.equal(charts[1].items[0].value, 148.2);
  assert.equal(charts[1].items[1].value, 372.65);
  assert.equal(charts[2].items[0].value, 381.96);
  assert.equal(charts[2].items[1].value, 836.39);
  assert.equal(charts[0].hint, '27 ventas');
  assert.equal(charts[1].hint, '29.9% del facturado');
  assert.equal(charts[2].hint, '11 pagadas · 16 pendientes');
  assert.equal(
    settlementCharts({ saleCount: 27, matchedCount: 20, bruto: 100, neto: 70 })[0].hint,
    '27 ventas · 20 cruzadas',
  );
  assert.ok(!charts.some((chart) => /precio|ticket/i.test(`${chart.hint} ${chart.items.map((item) => item.label).join(' ')}`)));
});

test('de cada 100 llena las diez columnas y parte comisión, logística y te llega', () => {
  const waffle = waffleOutOf100({ sold: 1739.2, commission: 258.35, shipping: 262.5 });
  assert.equal(waffle.cells.length, 100);
  assert.equal(waffle.counts.commission + waffle.counts.shipping + waffle.counts.arrives, 100);
  assert.equal(waffle.counts.commission, 15);
  assert.equal(waffle.counts.shipping, 15);
  assert.equal(waffle.counts.arrives, 70);
  assert.equal(waffle.cells[9], 'commission');
  assert.equal(waffle.cells[14], 'commission');
  assert.equal(waffle.cells[15], 'shipping');
  assert.equal(waffle.cells[29], 'shipping');
  assert.equal(waffle.cells[30], 'arrives');
  assert.equal(waffle.cells[99], 'arrives');
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
  const windowSecs = livelineWindowSecs(byDay);
  assert.ok(windowSecs >= 86400);
  assert.ok(windowSecs >= Math.floor(Date.now() / 1000) - byDay[0].time);
  assert.match(formatLivelineDay(byDay[0].time), /ago|set|ene|feb|mar|abr|may|jun|jul|oct|nov|dic/i);
});

test('decodifica un CSV Falabella en Windows-1252 cuando UTF-8 queda ilegible', () => {
  const header = 'Fecha creación de la orden,N° del orden,Estado de pago,Monto con IVA';
  const bytes = Uint8Array.from(Buffer.from(header, 'latin1'));
  const decoded = decodeSettlementCsv(bytes);
  assert.match(decoded, /creación/);
  assert.match(decoded, /Estado de pago/);
});

test('pasa un Excel de liquidación a CSV y reconoce la extensión', async () => {
  const { utils, write } = await import('xlsx');
  const sheet = utils.aoa_to_sheet([
    ['Fecha creación de la orden', 'N° del orden', 'Estado de pago', 'Monto con IVA', 'Tipo de transacción'],
    ['2026-08-19', '3248910865', 'Pagado', '8.99', 'Pago por precio del producto'],
  ]);
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, sheet, 'Reporte');
  const bytes = write(workbook, { type: 'array', bookType: 'xlsx' });
  const csv = decodeSettlementSpreadsheet(bytes);
  assert.match(csv, /del orden/);
  assert.match(csv, /Estado de pago/);
  assert.match(csv, /3248910865/);
  assert.equal(isSettlementSpreadsheet('NewReportTransaction.xlsx'), true);
  assert.equal(isSettlementSpreadsheet('estado.csv'), false);
  assert.equal(
    shortImportFilename('NewReportTransaction_FAPE-SCDE75A-20260820-PEN_2026-08-27T11_53_11.4043969.xlsx'),
    'FAPE-SCDE75A-20260820-PEN.xlsx',
  );
});

test('lee el NewReportTransaction xlsx de Falabella con preámbulo y dimensión corta', async () => {
  const { readFileSync } = await import('node:fs');
  const { parseSettlementCsv } = await import('../../../server/src/pagos-csv.js');
  const bytes = readFileSync(new URL('./fixtures/new-report-transaction.xlsx', import.meta.url));
  const csv = decodeSettlementSpreadsheet(bytes);
  assert.match(csv.split('\n')[0], /Nº de orden|N° de orden|Estado de pago/);
  assert.doesNotMatch(csv.split('\n')[0], /Fecha de actualización/);
  assert.match(csv, /Ergonómico/);
  assert.match(csv, /3249878585/);
  assert.match(csv, /CAM1471111/);
  assert.match(csv, /Pago por precio del producto/);
  const parsed = parseSettlementCsv(csv);
  assert.equal(parsed.binding.columns.orderId, 'Nº de orden');
  assert.equal(parsed.lines.length, 12);
  const sale = parsed.lines.find((line) => line.type.includes('precio del producto') && line.orderId === '3249878585');
  assert.equal(sale.productName, 'Mochila de camping trekking 40L - Resistente y Ergonómico');
  assert.equal(sale.sku, '13457');
  assert.equal(sale.amount, 54.99);
});

test('las cabeceras de dinero caben en título y una explicación', () => {
  for (const column of Object.values(PAGOS_COLUMN_COPY)) {
    assert.equal(column.label.split(/\s+/).length <= 2, true, column.label);
    assert.equal(column.hint.split(/\s+/).length <= 4, true, column.hint);
    assert.equal(column.hint.includes('\n'), false);
  }
  assert.equal(PAGOS_COLUMN_COPY.precio.hint, 'Producto');
  assert.equal(PAGOS_COLUMN_COPY.envio.hint, 'De la orden');
  assert.equal(PAGOS_COLUMN_COPY.boleta.hint, 'Suma + IGV');
  assert.equal(PAGOS_COLUMN_COPY.comision.hint, 'Falabella');
  assert.equal(PAGOS_COLUMN_COPY.logistica.hint, 'Falabella');
  assert.equal(PAGOS_COLUMN_COPY.total.hint, 'Suma + IGV');
  assert.equal(PAGOS_COLUMN_COPY.ganas.hint, 'Lo que te queda');
  assert.equal(salesPageNote(27, 27), '27 ventas');
  assert.equal(salesPageNote(1, 1), '1 venta');
  assert.equal(salesPageNote(2000, 5432), 'Mostrando 2000 de 5432. Afina la búsqueda.');
  assert.deepEqual(
    settlementStatementTotals([
      { bruto: 100, buyerShippingPaid: 50, commission: 20, shipping: 50 },
    ]),
    { product: 100, envio: 50, boleta: 150, commission: 20, logistics: 50, total: 70, ganas: 67.8 },
  );
  assert.deepEqual(
    settlementStatementTotals(null),
    { product: 0, envio: 0, boleta: 0, commission: 0, logistics: 0, total: 0, ganas: 0 },
  );
});

test('el cruce se nombra como en la mesa', () => {
  assert.equal(settlementStatusLabel('matched'), 'Cruzada');
  assert.equal(settlementStatusLabel('unmatched'), 'Sin cruzar');
  assert.equal(settlementMethodLabel('order_id'), 'ID de orden');
  assert.equal(unmatchedReasonLabel('ambiguous_order_id'), 'Varias ventas con el mismo pedido');
  assert.equal(unmatchedReasonLabel('no_unique_match'), 'Sin match único');
});
