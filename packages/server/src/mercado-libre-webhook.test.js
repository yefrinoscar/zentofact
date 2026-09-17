import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acknowledgeMercadoLibreWebhook,
  parseMercadoLibreResource,
  shipmentOrderIds,
  storedOrderIdsForShipment,
} from './mercado-libre-webhook.js';

test('parsea resources de pedidos y envíos', () => {
  assert.deepEqual(parseMercadoLibreResource('/orders/2000001234'), { kind: 'order', id: '2000001234' });
  assert.deepEqual(parseMercadoLibreResource('/shipments/99'), { kind: 'shipment', id: '99' });
  assert.equal(parseMercadoLibreResource('/items/MPE1'), null);
});

test('recupera las órdenes guardadas cuando el shipment nuevo no trae order_id', async () => {
  const calls = [];
  const ids = await storedOrderIdsForShipment(7, 'SHIP-9', {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ external_order_id: 'ML-1' }, { external_order_id: 'ML-2' }] };
    },
  });
  assert.deepEqual(ids, ['ML-1', 'ML-2']);
  assert.deepEqual(calls[0].params, [7, 'SHIP-9']);
});

test('extrae los order.id del envío sin fusionarlos', () => {
  assert.deepEqual(shipmentOrderIds({
    raw: { order_id: '1', orders: [{ id: '1' }, { id: '2' }] },
  }), ['1', '2']);
});

test('responde 200 antes de consultar Mercado Libre', async () => {
  const scheduled = [];
  const ack = acknowledgeMercadoLibreWebhook({ topic: 'orders_v2', resource: '/orders/1', user_id: 9 }, {
    schedule: (work) => scheduled.push(work),
    findCompany: async () => null,
  });
  assert.deepEqual(ack, { ok: true });
  assert.equal(scheduled.length, 1);
});
