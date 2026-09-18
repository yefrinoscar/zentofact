import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BANDEJA_URGENCY,
  canMarkFalabellaReady,
  canMarkLogisticsDelivered,
  canMarkLogisticsReady,
  canPrintLogisticsLabel,
  logisticsItemSku,
  logisticsReadyConfirmCopy,
  logisticsReadyActionLabel,
  logisticsBulkReadyActionLabel,
  logisticsReadySuccessCopy,
  logisticsRipleyLabelSoon,
  RIPLEY_LABEL_SOON_COPY,
  groupLogisticsByUrgency,
  labelWasPrinted,
  logisticsBulkReadyConfirmCopy,
  applyLogisticsReadyToInbox,
  applyLogisticsDeliveredToInbox,
  logisticsBulkDeliverSummary,
  logisticsBulkReadySummary,
  logisticsDeliverSuccessCopy,
  logisticsChannelClass,
  logisticsChannelLabel,
  logisticsCountLabel,
  logisticsUpdatedClock,
  isActiveLogisticsDeadline,
  openPdfPreviewTab,
  pdfPreviewLoadingHtml,
  pendingDeadlineHelper,
  readyPrintHelper,
  remainingReadyToPrint,
  showPdfInTab,
  updatePdfPreviewProgress,
  logisticsDeadlineLabel,
  logisticsDeliveryLabel,
  logisticsEmptyCopy,
  logisticsFlowCopy,
  logisticsFlowSteps,
  logisticsNextStep,
  logisticsPrintSuccessCopy,
  logisticsQuantityLabel,
  logisticsSkippedNotice,
  logisticsUrgency,
  BANDEJA_DEADLINE_FILTERS,
  bandejaDeadlineFilter,
  formatBandejaDeadlineDate,
  laterBandejaDeadlineDates,
  LOGISTICS_STAGES,
  LOGISTICS_URGENCIES,
  productImageCandidates,
  productImageSrc,
  visibleLogisticsChannels,
} from './logistics-inbox.ts';

test('la bandeja inicia mostrando todos los plazos', () => {
  assert.equal(DEFAULT_BANDEJA_URGENCY, null);
});

test('nombres cortos y colores por canal', () => {
  assert.equal(logisticsChannelLabel('falabella'), 'Falabella');
  assert.equal(logisticsChannelLabel('manual'), 'Propios');
  assert.equal(logisticsChannelLabel('mercado_libre'), 'Mercado Libre');
  assert.deepEqual(visibleLogisticsChannels({ ripley: false }).map((item) => item.value), ['all', 'falabella', 'mercado_libre', 'manual']);
  assert.equal(visibleLogisticsChannels().some((item) => item.value === 'ripley'), true);
  assert.match(logisticsChannelClass('ripley'), /violet/);
  assert.match(logisticsChannelClass('manual'), /teal/);
  assert.equal(logisticsQuantityLabel({ quantity: 6 }), 'x6');
  assert.equal(logisticsQuantityLabel({ quantity: 0 }), 'x1');
});

test('la entrega propia usa Express, no nosotros', () => {
  assert.equal(logisticsDeliveryLabel({ channelCode: 'manual', shipping: { type: 'envio', carrier: 'nosotros' } }), 'Express');
  assert.equal(logisticsDeliveryLabel({ channelCode: 'manual', shipping: { type: 'recojo' } }), 'Recojo');
  assert.equal(logisticsDeliveryLabel({ channelCode: 'falabella', shipping: {} }), 'Marketplace');
});

test('manual imprime siempre; Falabella imprime listo; Ripley confirma pero no imprime; enviados no imprimen', () => {
  assert.equal(canPrintLogisticsLabel({ channelCode: 'manual', fulfillmentStatus: 'pending' }), true);
  assert.equal(canPrintLogisticsLabel({ channelCode: 'manual', fulfillmentStatus: 'shipped' }), false);
  assert.equal(canPrintLogisticsLabel({ channelCode: 'falabella', fulfillmentStatus: 'pending', companyId: 1 }), false);
  assert.equal(canPrintLogisticsLabel({ channelCode: 'falabella', fulfillmentStatus: 'ready_to_ship', companyId: 1 }), true);
  assert.equal(canPrintLogisticsLabel({
    channelCode: 'mercado_libre', fulfillmentStatus: 'pending', companyId: 1, metadata: { shippingId: '900000030' },
  }), false);
  assert.equal(canPrintLogisticsLabel({
    channelCode: 'mercado_libre', fulfillmentStatus: 'ready_to_ship', companyId: 1,
    metadata: { shippingId: '900000031', shippingMode: 'me2', logisticType: 'drop_off', shippingSubstatus: 'ready_to_print' },
  }), true);
  assert.equal(canPrintLogisticsLabel({
    channelCode: 'mercado_libre', fulfillmentStatus: 'ready_to_ship', companyId: 1,
  }), false);
  assert.equal(canPrintLogisticsLabel({ channelCode: 'ripley', fulfillmentStatus: 'ready_to_ship', companyId: 1 }), false);
  assert.equal(canPrintLogisticsLabel({ channelCode: 'mercado_libre', fulfillmentStatus: 'preparing', companyId: 1, metadata: { shippingId: 'S1' } }), false);
  assert.equal(canPrintLogisticsLabel({ channelCode: 'mercado_libre', fulfillmentStatus: 'ready_to_ship', companyId: 1, metadata: { shippingId: 'S1', shippingMode: 'me2', logisticType: 'cross_docking', shippingSubstatus: 'ready_to_print' } }), true);
  assert.equal(canPrintLogisticsLabel({ channelCode: 'mercado_libre', fulfillmentStatus: 'ready_to_ship', companyId: 1, metadata: { shippingId: 'S1', logisticType: 'cross_docking', shippingSubstatus: 'ready_to_print' } }), false);
  assert.equal(canPrintLogisticsLabel({ channelCode: 'mercado_libre', fulfillmentStatus: 'ready_to_ship', companyId: 1, metadata: { shippingId: 'S1', shippingMode: 'me2', logisticType: 'cross_docking', shippingSubstatus: 'waiting_for_label_generation' } }), false);
  assert.equal(canPrintLogisticsLabel({ channelCode: 'mercado_libre', fulfillmentStatus: 'ready_to_ship', companyId: 1, metadata: { shippingId: 'S1', shippingMode: 'me2', logisticType: 'fulfillment', shippingSubstatus: 'ready_to_print' } }), false);
  assert.equal(logisticsRipleyLabelSoon({ channelCode: 'ripley', fulfillmentStatus: 'ready_to_ship', companyId: 1 }), false);
  assert.equal(logisticsRipleyLabelSoon({ channelCode: 'ripley', fulfillmentStatus: 'shipped', companyId: 1 }), false);
  assert.equal(RIPLEY_LABEL_SOON_COPY, 'Muy pronto.');
  assert.equal(canMarkFalabellaReady({
    channelCode: 'falabella', fulfillmentStatus: 'pending', companyId: 3, externalOrderId: 'F-1',
  }), true);
  assert.equal(canMarkFalabellaReady({
    channelCode: 'manual', fulfillmentStatus: 'pending', companyId: 3, externalOrderId: 'M-1',
  }), false);
  assert.equal(canMarkLogisticsReady({
    channelCode: 'ripley', fulfillmentStatus: 'pending', companyId: 2, externalOrderId: 'R-1',
  }), true);
  assert.equal(canMarkLogisticsReady({
    channelCode: 'ripley', fulfillmentStatus: 'preparing', companyId: 2, externalOrderId: 'R-1',
  }), true);
  assert.equal(canMarkLogisticsReady({
    channelCode: 'ripley', fulfillmentStatus: 'ready_to_ship', companyId: 2, externalOrderId: 'R-1',
  }), false);
  assert.equal(canMarkLogisticsReady({
    channelCode: 'mercado_libre', fulfillmentStatus: 'preparing', companyId: 2, externalOrderId: 'ML-1',
  }), false);
  assert.equal(logisticsRipleyLabelSoon({
    channelCode: 'ripley', fulfillmentStatus: 'pending', companyId: 2, externalOrderId: 'R-1',
  }), false);
  assert.equal(logisticsItemSku({ mainSku: 'HOG025', sku: 'S126718' }), 'HOG025');
  assert.equal(logisticsItemSku({ sku: 'HOG025', shopSku: 'S126718' }), 'HOG025');
});

test('la urgencia y el plazo se leen como en la bandeja Falabella', () => {
  const now = new Date('2026-09-02T15:00:00.000Z');
  assert.equal(logisticsUrgency({ promisedShippingAt: null }, now), 'later');
  assert.equal(logisticsUrgency({ promisedShippingAt: '2026-09-01T22:00:00.000Z' }, now), 'overdue');
  assert.equal(logisticsUrgency({ promisedShippingAt: '2026-09-02T14:00:00.000Z' }, now), 'today');
  assert.equal(logisticsUrgency({ promisedShippingAt: '2026-09-02T22:00:00.000Z' }, now), 'today');
  assert.equal(logisticsUrgency({ promisedShippingAt: '2026-09-03T17:00:00.000Z' }, now), 'tomorrow');
  assert.match(logisticsDeadlineLabel({ promisedShippingAt: '2026-09-01T22:00:00.000Z' }, now), /^Venció hace /);
  assert.match(logisticsDeadlineLabel({ promisedShippingAt: '2026-09-02T14:00:00.000Z' }, now), /^Hoy · /);
  assert.match(logisticsDeadlineLabel({ promisedShippingAt: '2026-09-02T22:00:00.000Z' }, now), /^Hoy · /);
  assert.match(logisticsDeadlineLabel({ promisedShippingAt: '2026-09-03T17:00:00.000Z' }, now), /^Mañana · /);
  assert.equal(logisticsDeadlineLabel({ promisedShippingAt: null }, now), 'Sin plazo informado');
  assert.equal(isActiveLogisticsDeadline({ promisedShippingAt: null }, now), false);
  assert.equal(isActiveLogisticsDeadline({ promisedShippingAt: '2026-09-01T22:00:00.000Z' }, now), true);
  assert.equal(isActiveLogisticsDeadline({ promisedShippingAt: '2026-09-02T14:00:00.000Z' }, now), true);
  assert.equal(isActiveLogisticsDeadline({ promisedShippingAt: '2026-09-02T22:00:00.000Z' }, now), true);
  assert.deepEqual(LOGISTICS_URGENCIES.map((item) => item.label), ['Vencidos', 'Vencen hoy', 'Vencen mañana', 'Próximos']);
  assert.deepEqual(BANDEJA_DEADLINE_FILTERS.map((item) => item.label), ['Vencen hoy', 'Vencen mañana']);
  assert.equal(bandejaDeadlineFilter('overdue'), null);
  assert.equal(bandejaDeadlineFilter('later'), null);
  assert.equal(bandejaDeadlineFilter(null), null);
  assert.equal(bandejaDeadlineFilter('today'), 'today');
  assert.equal(formatBandejaDeadlineDate('2026-09-07', now), '7 de setiembre');
  assert.equal(formatBandejaDeadlineDate('2026-09-08', now), '8 de setiembre');
  assert.deepEqual(
    laterBandejaDeadlineDates([
      { date: '2026-09-01', count: 5 },
      { date: '2026-09-02', count: 3 },
      { date: '2026-09-03', count: 1 },
      { date: '2026-09-07', count: 4 },
      { date: '2026-09-08', count: 2 },
    ], now).map((item) => item.date),
    ['2026-09-07', '2026-09-08'],
  );
  const groups = groupLogisticsByUrgency([
    { id: 1, promisedShippingAt: '2026-09-05T17:00:00.000Z' },
    { id: 2, promisedShippingAt: '2026-09-01T22:00:00.000Z' },
    { id: 3, promisedShippingAt: '2026-09-01T13:00:00.000Z' },
  ], now);
  assert.deepEqual(groups.map((group) => [group.urgency, group.orders.length]), [['overdue', 2], ['later', 1]]);
  assert.deepEqual(LOGISTICS_STAGES.map((item) => item.label), ['Pendientes', 'Listos para enviar', 'Enviados']);
});

test('el siguiente paso depende del canal, el estado y la impresión previa', () => {
  assert.deepEqual(logisticsNextStep({ channelCode: 'manual', fulfillmentStatus: 'pending' }), { kind: 'deliver', label: 'Marcar entregado' });
  assert.deepEqual(
    logisticsNextStep({ channelCode: 'manual', fulfillmentStatus: 'ready_to_ship', labelPrint: { printCount: 2 } }),
    { kind: 'deliver', label: 'Marcar entregado' },
  );
  assert.equal(canMarkLogisticsDelivered({ channelCode: 'manual', fulfillmentStatus: 'pending' }), true);
  assert.equal(canMarkLogisticsDelivered({ channelCode: 'falabella', fulfillmentStatus: 'pending' }), false);
  assert.equal(canPrintLogisticsLabel({ channelCode: 'manual', fulfillmentStatus: 'pending' }), true);
  assert.deepEqual(
    logisticsNextStep({ channelCode: 'falabella', fulfillmentStatus: 'pending', companyId: 1, externalOrderId: 'F-1' }),
    { kind: 'ready', label: 'Marcar listo' },
  );
  assert.deepEqual(logisticsNextStep({ channelCode: 'falabella', fulfillmentStatus: 'shipped', companyId: 1 }), { kind: 'view', label: 'Ver detalle' });
  assert.deepEqual(
    logisticsNextStep({ channelCode: 'mercado_libre', fulfillmentStatus: 'pending', companyId: 1 }),
    { kind: 'wait', label: 'Esperando etiqueta' },
  );
  assert.deepEqual(
    logisticsNextStep({
      channelCode: 'mercado_libre',
      fulfillmentStatus: 'ready_to_ship',
      companyId: 1,
      metadata: { shippingId: '900000031', shippingMode: 'me2', logisticType: 'drop_off', shippingSubstatus: 'ready_to_print' },
    }),
    { kind: 'print', label: 'Imprimir' },
  );
  assert.deepEqual(
    logisticsNextStep({ channelCode: 'ripley', fulfillmentStatus: 'pending', companyId: 1, externalOrderId: 'R-1' }),
    { kind: 'ready', label: 'Agendar recojo' },
  );
  assert.equal(logisticsReadyActionLabel({ channelCode: 'ripley' }), 'Agendar recojo');
  assert.equal(logisticsReadyActionLabel({ channelCode: 'falabella' }), 'Marcar listo');
  assert.equal(logisticsBulkReadyActionLabel([{ channelCode: 'ripley' }, { channelCode: 'ripley' }]), 'Agendar 2 recojos');
  assert.equal(logisticsBulkReadyActionLabel([{ channelCode: 'ripley' }, { channelCode: 'falabella' }]), 'Marcar 2 listos');
  assert.deepEqual(
    logisticsNextStep({ channelCode: 'ripley', fulfillmentStatus: 'ready_to_ship', companyId: 1 }),
    { kind: 'wait', label: 'Gestionar en Ripley' },
  );
  assert.deepEqual(
    logisticsNextStep({ channelCode: 'mercado_libre', fulfillmentStatus: 'preparing', companyId: 1, metadata: { shippingId: 'S1' } }),
    { kind: 'wait', label: 'Esperando etiqueta' },
  );
  assert.deepEqual(
    logisticsNextStep({ channelCode: 'mercado_libre', fulfillmentStatus: 'ready_to_ship', companyId: 1, metadata: { shippingId: 'S1', shippingMode: 'me2', logisticType: 'cross_docking', shippingSubstatus: 'ready_to_print' } }),
    { kind: 'print', label: 'Imprimir' },
  );
  assert.equal(labelWasPrinted({ labelPrint: { printCount: 1 } }), true);
  assert.equal(labelWasPrinted({ labelPrint: null }), false);
});

test('el flujo de despacho marca los pasos completados', () => {
  assert.deepEqual(
    logisticsFlowSteps({ channelCode: 'falabella', fulfillmentStatus: 'ready_to_ship', companyId: 1 }).map((step) => step.state),
    ['done', 'done', 'current'],
  );
  assert.deepEqual(
    logisticsFlowSteps({ channelCode: 'manual', fulfillmentStatus: 'pending', labelPrint: { printCount: 1 } }).map((step) => [step.label, step.state]),
    [['Empacar', 'current'], ['Entregar', 'todo']],
  );
  assert.deepEqual(
    logisticsFlowSteps({ channelCode: 'manual', fulfillmentStatus: 'shipped' }).map((step) => [step.label, step.state]),
    [['Empacar', 'done'], ['Entregar', 'done']],
  );
  assert.deepEqual(
    logisticsFlowSteps({ channelCode: 'ripley', fulfillmentStatus: 'pending', companyId: 1, externalOrderId: 'R-1' }).map((step) => [step.label, step.state]),
    [['Empacar', 'current'], ['Confirmar recojo', 'todo'], ['Etiqueta', 'todo']],
  );
  assert.deepEqual(
    logisticsFlowSteps({ channelCode: 'ripley', fulfillmentStatus: 'ready_to_ship', companyId: 1 }).map((step) => [step.label, step.state]),
    [['Empacar', 'done'], ['Confirmar recojo', 'done'], ['Etiqueta', 'todo']],
  );
});

test('Mercado Libre espera ME2 y luego imprime 10×15', () => {
  assert.match(
    logisticsFlowCopy({ channelCode: 'mercado_libre', fulfillmentStatus: 'pending', companyId: 1 }),
    /Espera a que Mercado Envíos/,
  );
  assert.match(
    logisticsFlowCopy({
      channelCode: 'mercado_libre',
      fulfillmentStatus: 'ready_to_ship',
      companyId: 1,
      metadata: {
        shippingId: '900000031',
        shippingMode: 'me2',
        logisticType: 'drop_off',
        shippingSubstatus: 'ready_to_print',
      },
    }),
    /10×15/,
  );
  assert.deepEqual(
    logisticsFlowSteps({ channelCode: 'mercado_libre', fulfillmentStatus: 'ready_to_ship', companyId: 1 }).map((step) => step.label),
    ['Preparar', 'Etiqueta ME2', 'Despachar'],
  );
});

test('copy operativa de bandeja', () => {
  assert.equal(logisticsCountLabel('pending', 1), '1 pedido');
  assert.equal(logisticsCountLabel('ready', 2), '2 etiquetas');
  assert.equal(logisticsEmptyCopy('pending'), 'Nada que preparar con estos filtros.');
  assert.equal(logisticsEmptyCopy('ready'), 'No hay pedidos confirmados.');
  assert.equal(remainingReadyToPrint({ readyUnprinted: 3 }), 3);
  assert.equal(remainingReadyToPrint({ readyUnprinted: 0, ready: 27 }), 0);
  assert.equal(remainingReadyToPrint({ ready: 27 }), 27);
  assert.equal(remainingReadyToPrint({}), 0);
  assert.match(logisticsEmptyCopy('pending', 'today'), /Vencen hoy/);
  assert.match(logisticsEmptyCopy('pending', null, '8 de setiembre'), /8 de setiembre/);
  assert.equal(logisticsSkippedNotice([{ id: 1, reason: 'Ripley aún no tiene etiqueta.' }]), 'Ripley aún no tiene etiqueta.');
  assert.equal(logisticsPrintSuccessCopy({ labelCount: 1 }), 'Listo. 1 etiqueta.');
  assert.equal(logisticsPrintSuccessCopy({ labelCount: 3 }), 'Listo. 3 etiquetas.');
  assert.equal(logisticsBulkReadySummary(3, 0), '3 pedidos marcados listos para enviar.');
  assert.equal(logisticsBulkReadySummary(3, 1), '2 marcados; 1 no pudo actualizarse.');
  assert.match(logisticsBulkReadyConfirmCopy([
    { channelCode: 'falabella' },
    { channelCode: 'ripley' },
  ]), /Falabella confirma listo/);
  assert.match(logisticsBulkReadyConfirmCopy([{ channelCode: 'ripley' }]), /recojo en Mirakl/);
  assert.match(
    logisticsReadyConfirmCopy({ channelCode: 'ripley' }),
    /Mirakl/,
  );
  assert.match(
    logisticsReadySuccessCopy({ channelCode: 'ripley', externalOrderNumber: 'RP-10020' }),
    /RP-10020.*confirmado en Ripley/,
  );
  assert.match(
    logisticsReadySuccessCopy({ channelCode: 'falabella', externalOrderNumber: 'PV-10001' }),
    /imprimir la etiqueta/,
  );
});

test('marcar listo saca el pedido de pendientes y lo cuenta en listos', () => {
  const inbox = {
    orders: [
      { id: 10, promisedShippingAt: '2026-09-08T21:00:00.000Z' },
      { id: 11, promisedShippingAt: '2026-09-08T22:00:00.000Z' },
    ],
    counts: {
      pending: 52,
      ready: 3,
      readyUnprinted: 1,
      shipped: 10,
      dates: [{ date: '2026-09-08', count: 2 }],
    },
    totalCount: 52,
  };
  const next = applyLogisticsReadyToInbox(inbox, [10]);
  assert.deepEqual(next.orders.map((order) => order.id), [11]);
  assert.equal(next.counts.pending, 51);
  assert.equal(next.counts.ready, 4);
  assert.equal(next.counts.readyUnprinted, 2);
  assert.equal(next.totalCount, 51);
  assert.deepEqual(next.counts.dates, [{ date: '2026-09-08', count: 1 }]);
  assert.equal(applyLogisticsReadyToInbox(inbox, [99]), inbox);
});

test('marcar entregado saca el pedido propio de la bandeja abierta', () => {
  const inbox = {
    orders: [
      { id: 10, promisedShippingAt: '2026-09-08T21:00:00.000Z', fulfillmentStatus: 'pending' },
      { id: 11, promisedShippingAt: '2026-09-08T22:00:00.000Z', fulfillmentStatus: 'ready_to_ship' },
      { id: 12, promisedShippingAt: '2026-09-08T23:00:00.000Z', fulfillmentStatus: 'ready_to_ship', labelPrint: { printCount: 1 } },
    ],
    counts: {
      pending: 4,
      ready: 3,
      readyUnprinted: 2,
      shipped: 10,
      dates: [{ date: '2026-09-08', count: 2 }],
    },
    totalCount: 7,
  };
  const next = applyLogisticsDeliveredToInbox(inbox, [10, 11]);
  assert.deepEqual(next.orders.map((order) => order.id), [12]);
  assert.equal(next.counts.pending, 3);
  assert.equal(next.counts.ready, 2);
  assert.equal(next.counts.readyUnprinted, 1);
  assert.equal(next.counts.shipped, 12);
  assert.equal(next.totalCount, 5);
  assert.equal(logisticsDeliverSuccessCopy({ externalOrderNumber: 'QNC-10010' }), 'QNC-10010 quedó entregado.');
  assert.equal(logisticsBulkDeliverSummary(2, 0), '2 pedidos marcados como entregados.');
});

test('el filtro de etapa resume plazo y lo que falta imprimir', () => {
  const now = new Date('2026-09-02T15:00:00.000Z');
  const pending = [
    { channelCode: 'falabella', fulfillmentStatus: 'pending', companyId: 1, externalOrderId: 'F-1', promisedShippingAt: '2026-09-02T22:00:00.000Z' },
    { channelCode: 'falabella', fulfillmentStatus: 'pending', companyId: 1, externalOrderId: 'F-2', promisedShippingAt: '2026-09-02T23:00:00.000Z' },
    { channelCode: 'ripley', fulfillmentStatus: 'pending', companyId: 2, promisedShippingAt: '2026-09-03T17:00:00.000Z' },
    { channelCode: 'manual', fulfillmentStatus: 'pending', promisedShippingAt: '2026-09-05T17:00:00.000Z' },
    { channelCode: 'manual', fulfillmentStatus: 'pending', promisedShippingAt: '2026-09-01T22:00:00.000Z' },
  ];
  const ready = [
    { channelCode: 'falabella', fulfillmentStatus: 'ready_to_ship', companyId: 1 },
    { channelCode: 'manual', fulfillmentStatus: 'pending', labelPrint: { printCount: 1 } },
  ];
  assert.equal(pendingDeadlineHelper(pending, now), '1 vencido · 2 hoy · 1 mañana');
  assert.equal(readyPrintHelper(ready), '1 por imprimir');
  assert.equal(readyPrintHelper([{ channelCode: 'manual', fulfillmentStatus: 'pending', labelPrint: { printCount: 2 } }]), 'Ya impresa');
  assert.match(logisticsUpdatedClock(new Date('2026-09-02T15:32:00.000Z')), /10:32/);
});

test('la pestaña de impresión muestra una hoja de etiquetas, no un texto suelto', () => {
  const html = pdfPreviewLoadingHtml(3);
  assert.match(html, /Armando las etiquetas/);
  assert.match(html, /0 de 3/);
  assert.match(html, /class="press"/);
  assert.match(html, /class="head"/);
  assert.match(html, /id="print-progress-bar"/);
  assert.equal(pdfPreviewLoadingHtml(1).includes('0 de 1'), true);
  assert.equal(pdfPreviewLoadingHtml(0).includes('0 etiqueta'), false);
});

test('actualiza la pestaña con la etiqueta y el pedido en curso', () => {
  const nodes = new Map([
    ['print-progress-title', { textContent: '', style: { setProperty() {} } }],
    ['print-progress-detail', { textContent: '', style: { setProperty() {} } }],
    ['print-progress-count', { textContent: '', style: { setProperty() {} } }],
    ['print-progress-bar', { textContent: '', style: { setProperty(name, value) { this[name] = value; } } }],
  ]);
  const preview = {
    closed: false,
    document: {
      title: '',
      getElementById(id) { return nodes.get(id) || null; },
    },
  };
  updatePdfPreviewProgress(preview, { current: 18, total: 64, orderNumber: 'PV-10018' });
  assert.equal(nodes.get('print-progress-title').textContent, 'Armando la etiqueta 18 de 64');
  assert.equal(nodes.get('print-progress-detail').textContent, 'Pedido PV-10018');
  assert.equal(nodes.get('print-progress-count').textContent, '18 de 64');
  assert.equal(nodes.get('print-progress-bar').style['--progress'], '28%');
  assert.equal(preview.document.title, 'Etiqueta 18 de 64');
});

test('el PDF de bandeja se abre en otra pestaña y no se descarga', () => {
  const opened = [];
  const downloads = [];
  const preview = {
    closed: false,
    opener: {},
    location: { href: '', replace(url) { this.href = url; } },
    document: { open() {}, write() {}, close() {} },
  };
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const createObjectURL = URL.createObjectURL;
  const revokeObjectURL = URL.revokeObjectURL;
  globalThis.window = {
    open(url, target) {
      opened.push({ url, target });
      return preview;
    },
    setTimeout(fn) { return globalThis.setTimeout(fn, 0); },
  };
  globalThis.document = {
    createElement() {
      return {
        set href(_) {},
        set download(_) { downloads.push('download'); },
        click() { downloads.push('click'); },
      };
    },
  };
  URL.createObjectURL = () => 'blob:pdf';
  URL.revokeObjectURL = () => {};
  try {
    const tab = openPdfPreviewTab();
    assert.equal(tab, preview);
    assert.equal(opened[0]?.url, '');
    assert.equal(opened[0]?.target, '_blank');
    assert.equal(showPdfInTab(tab, Buffer.from('%PDF').toString('base64')), true);
    assert.equal(preview.location.href, 'blob:pdf');
    assert.deepEqual(downloads, []);
  } finally {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('las imágenes de Falabella y Ripley pasan por el proxy del catálogo', () => {
  assert.equal(productImageSrc('https://cdn.example/p.jpg'), 'https://cdn.example/p.jpg');
  assert.match(productImageSrc('', 'ABC123'), /^\/catalog\/image\?url=https%3A%2F%2Fmedia\.falabella\.com/);
  assert.match(
    productImageSrc('https://home.ripley.com.pe/desk.jpg'),
    /^\/catalog\/image\?url=https%3A%2F%2Fhome\.ripley\.com\.pe/,
  );
  assert.equal(productImageSrc('', ''), '');
});

test('conserva la foto del SKU como alternativa cuando falla la URL del pedido', () => {
  assert.deepEqual(
    productImageCandidates('https://media.falabella.com/falabellaPE/antigua_01', 'ABC123'),
    [
      '/catalog/image?url=https%3A%2F%2Fmedia.falabella.com%2FfalabellaPE%2Fantigua_01',
      '/catalog/image?url=https%3A%2F%2Fmedia.falabella.com%2FfalabellaPE%2FABC123_01',
      '/catalog/image?url=https%3A%2F%2Fmedia.falabella.com%2FfalabellaPE%2FABC123_1',
    ],
  );
});
