import test from 'node:test';
import assert from 'node:assert/strict';
import { canCancelManualOrder } from './manual-order-cancellation.ts';

test('permite cancelar pedidos de tienda activos', () => {
  for (const fulfillmentStatus of ['pending', 'preparing', 'ready_to_ship', 'shipped', 'delivered']) {
    assert.equal(canCancelManualOrder({ channelCode: 'manual', orderStatus: 'confirmed', fulfillmentStatus }), true);
  }
});

test('oculta cancelar para marketplaces y pedidos terminados', () => {
  for (const channelCode of ['falabella', 'ripley', 'mercado_libre']) {
    assert.equal(canCancelManualOrder({ channelCode, orderStatus: 'confirmed', fulfillmentStatus: 'pending' }), false);
  }
  for (const fulfillmentStatus of ['cancelled', 'returned', 'failed']) {
    assert.equal(canCancelManualOrder({ channelCode: 'manual', orderStatus: 'confirmed', fulfillmentStatus }), false);
  }
  for (const orderStatus of ['cancelled', 'failed']) {
    assert.equal(canCancelManualOrder({ channelCode: 'manual', orderStatus, fulfillmentStatus: 'pending' }), false);
  }
});
