import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canMarkFalabellaReady,
  canPrintLogisticsLabel,
  logisticsChannelClass,
  logisticsChannelLabel,
  logisticsCountLabel,
  logisticsDeliveryLabel,
  logisticsEmptyCopy,
  logisticsSkippedNotice,
} from './logistics-inbox.ts';

test('nombres cortos y colores por canal', () => {
  assert.equal(logisticsChannelLabel('falabella'), 'Falabella');
  assert.equal(logisticsChannelLabel('manual'), 'Manual');
  assert.match(logisticsChannelClass('ripley'), /fuchsia/);
  assert.match(logisticsChannelClass('manual'), /teal/);
});

test('la entrega propia usa Express, no nosotros', () => {
  assert.equal(logisticsDeliveryLabel({ channelCode: 'manual', shipping: { type: 'envio', carrier: 'nosotros' } }), 'Express');
  assert.equal(logisticsDeliveryLabel({ channelCode: 'manual', shipping: { type: 'recojo' } }), 'Recojo');
  assert.equal(logisticsDeliveryLabel({ channelCode: 'falabella', shipping: {} }), 'Marketplace');
});

test('manual imprime siempre; Falabella solo si está listo', () => {
  assert.equal(canPrintLogisticsLabel({ channelCode: 'manual', fulfillmentStatus: 'pending' }), true);
  assert.equal(canPrintLogisticsLabel({ channelCode: 'falabella', fulfillmentStatus: 'pending', companyId: 1 }), false);
  assert.equal(canPrintLogisticsLabel({ channelCode: 'falabella', fulfillmentStatus: 'ready_to_ship', companyId: 1 }), true);
  assert.equal(canMarkFalabellaReady({
    channelCode: 'falabella', fulfillmentStatus: 'pending', companyId: 3, externalOrderId: 'F-1',
  }), true);
  assert.equal(canMarkFalabellaReady({
    channelCode: 'manual', fulfillmentStatus: 'pending', companyId: 3, externalOrderId: 'M-1',
  }), false);
});

test('copy operativa de bandeja', () => {
  assert.equal(logisticsCountLabel('pending', 1), '1 pedido');
  assert.equal(logisticsCountLabel('ready', 2), '2 etiquetas');
  assert.equal(logisticsEmptyCopy('pending'), 'Nada que preparar con estos filtros.');
  assert.equal(logisticsSkippedNotice([{ id: 1, reason: 'Ripley aún no tiene etiqueta.' }]), 'Ripley aún no tiene etiqueta.');
});
