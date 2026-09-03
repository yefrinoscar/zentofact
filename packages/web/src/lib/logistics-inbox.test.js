import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canMarkFalabellaReady,
  canPrintLogisticsLabel,
  groupLogisticsByUrgency,
  labelWasPrinted,
  logisticsBulkReadySummary,
  logisticsChannelClass,
  logisticsChannelLabel,
  logisticsCountLabel,
  isActiveLogisticsDeadline,
  logisticsDeadlineLabel,
  logisticsDeliveryLabel,
  logisticsEmptyCopy,
  logisticsFlowSteps,
  logisticsNextStep,
  logisticsPrintSuccessCopy,
  logisticsQuantityLabel,
  logisticsSkippedNotice,
  logisticsUrgency,
  LOGISTICS_STAGES,
  LOGISTICS_URGENCIES,
  productImageSrc,
} from './logistics-inbox.ts';

test('nombres cortos y colores por canal', () => {
  assert.equal(logisticsChannelLabel('falabella'), 'Falabella');
  assert.equal(logisticsChannelLabel('manual'), 'Manual');
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

test('manual imprime siempre; Falabella solo si está listo; enviados no imprimen', () => {
  assert.equal(canPrintLogisticsLabel({ channelCode: 'manual', fulfillmentStatus: 'pending' }), true);
  assert.equal(canPrintLogisticsLabel({ channelCode: 'manual', fulfillmentStatus: 'shipped' }), false);
  assert.equal(canPrintLogisticsLabel({ channelCode: 'falabella', fulfillmentStatus: 'pending', companyId: 1 }), false);
  assert.equal(canPrintLogisticsLabel({ channelCode: 'falabella', fulfillmentStatus: 'ready_to_ship', companyId: 1 }), true);
  assert.equal(canMarkFalabellaReady({
    channelCode: 'falabella', fulfillmentStatus: 'pending', companyId: 3, externalOrderId: 'F-1',
  }), true);
  assert.equal(canMarkFalabellaReady({
    channelCode: 'manual', fulfillmentStatus: 'pending', companyId: 3, externalOrderId: 'M-1',
  }), false);
});

test('la urgencia y el plazo se leen como en la bandeja Falabella', () => {
  const now = new Date('2026-09-02T15:00:00.000Z');
  assert.equal(logisticsUrgency({ promisedShippingAt: null }, now), 'later');
  assert.equal(logisticsUrgency({ promisedShippingAt: '2026-09-02T14:00:00.000Z' }, now), 'overdue');
  assert.equal(logisticsUrgency({ promisedShippingAt: '2026-09-02T22:00:00.000Z' }, now), 'today');
  assert.equal(logisticsUrgency({ promisedShippingAt: '2026-09-03T17:00:00.000Z' }, now), 'tomorrow');
  assert.equal(logisticsDeadlineLabel({ promisedShippingAt: '2026-09-02T14:00:00.000Z' }, now), 'Venció hace 1 h');
  assert.match(logisticsDeadlineLabel({ promisedShippingAt: '2026-09-02T22:00:00.000Z' }, now), /^Hoy · /);
  assert.match(logisticsDeadlineLabel({ promisedShippingAt: '2026-09-03T17:00:00.000Z' }, now), /^Mañana · /);
  assert.equal(logisticsDeadlineLabel({ promisedShippingAt: null }, now), 'Sin plazo informado');
  assert.equal(isActiveLogisticsDeadline({ promisedShippingAt: null }, now), false);
  assert.equal(isActiveLogisticsDeadline({ promisedShippingAt: '2026-09-02T14:00:00.000Z' }, now), false);
  assert.equal(isActiveLogisticsDeadline({ promisedShippingAt: '2026-09-02T22:00:00.000Z' }, now), true);
  assert.deepEqual(LOGISTICS_URGENCIES.map((item) => item.label), ['Vencidos', 'Vencen hoy', 'Vencen mañana', 'Próximos']);
  const groups = groupLogisticsByUrgency([
    { id: 1, promisedShippingAt: '2026-09-05T17:00:00.000Z' },
    { id: 2, promisedShippingAt: '2026-09-02T14:00:00.000Z' },
    { id: 3, promisedShippingAt: '2026-09-02T13:00:00.000Z' },
  ], now);
  assert.deepEqual(groups.map((group) => [group.urgency, group.orders.length]), [['overdue', 2], ['later', 1]]);
  assert.deepEqual(LOGISTICS_STAGES.map((item) => item.label), ['Pendientes', 'Listos para enviar', 'Enviados']);
});

test('el siguiente paso depende del canal, el estado y la impresión previa', () => {
  assert.deepEqual(logisticsNextStep({ channelCode: 'manual', fulfillmentStatus: 'pending' }), { kind: 'print', label: 'Imprimir' });
  assert.deepEqual(
    logisticsNextStep({ channelCode: 'manual', fulfillmentStatus: 'pending', labelPrint: { printCount: 2 } }),
    { kind: 'print', label: 'Reimprimir' },
  );
  assert.deepEqual(
    logisticsNextStep({ channelCode: 'falabella', fulfillmentStatus: 'pending', companyId: 1, externalOrderId: 'F-1' }),
    { kind: 'ready', label: 'Marcar listo' },
  );
  assert.deepEqual(logisticsNextStep({ channelCode: 'falabella', fulfillmentStatus: 'shipped', companyId: 1 }), { kind: 'view', label: 'Ver detalle' });
  assert.equal(labelWasPrinted({ labelPrint: { printCount: 1 } }), true);
  assert.equal(labelWasPrinted({ labelPrint: null }), false);
});

test('el flujo de despacho marca los pasos completados', () => {
  assert.deepEqual(
    logisticsFlowSteps({ channelCode: 'falabella', fulfillmentStatus: 'ready_to_ship', companyId: 1 }).map((step) => step.state),
    ['done', 'done', 'current'],
  );
  assert.deepEqual(
    logisticsFlowSteps({ channelCode: 'manual', fulfillmentStatus: 'pending', labelPrint: { printCount: 1 } }).map((step) => step.state),
    ['done', 'done', 'current'],
  );
  assert.deepEqual(
    logisticsFlowSteps({ channelCode: 'manual', fulfillmentStatus: 'shipped' }).map((step) => step.state),
    ['done', 'done', 'done'],
  );
});

test('copy operativa de bandeja', () => {
  assert.equal(logisticsCountLabel('pending', 1), '1 pedido');
  assert.equal(logisticsCountLabel('ready', 2), '2 etiquetas');
  assert.equal(logisticsEmptyCopy('pending'), 'Nada que preparar con estos filtros.');
  assert.match(logisticsEmptyCopy('pending', 'today'), /Vencen hoy/);
  assert.equal(logisticsSkippedNotice([{ id: 1, reason: 'Ripley aún no tiene etiqueta.' }]), 'Ripley aún no tiene etiqueta.');
  assert.equal(logisticsPrintSuccessCopy({ labelCount: 1, packingPageCount: 1 }), 'Listo. 1 etiqueta y 1 hoja de armado.');
  assert.equal(logisticsPrintSuccessCopy({ labelCount: 3, packingPageCount: 0 }), 'Listo. 3 etiquetas.');
  assert.equal(logisticsBulkReadySummary(3, 0), '3 pedidos marcados listos para enviar.');
  assert.equal(logisticsBulkReadySummary(3, 1), '2 marcados; 1 no pudo actualizarse.');
});

test('las imágenes de Falabella pasan por el proxy del catálogo', () => {
  assert.equal(productImageSrc('https://cdn.example/p.jpg'), 'https://cdn.example/p.jpg');
  assert.match(productImageSrc('', 'ABC123'), /^\/catalog\/image\?url=https%3A%2F%2Fmedia\.falabella\.com/);
  assert.equal(productImageSrc('', ''), '');
});
