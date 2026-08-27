import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mapRipleyCanonicalStatus,
  mapRipleyOrderItems,
  mapRipleyShipping,
} from './order-adapters/ripley.js';
import {
  drainMissingRipleyOrderItems,
  ripleySyncWindow,
  syncAllRipleyOrders,
} from './ripley-orders.js';

test('el polling incremental usa el cursor de la última sincronización', () => {
  assert.deepEqual(
    ripleySyncWindow({}, '2026-08-20T10:00:00Z'),
    { startUpdateDate: '2026-08-20T10:00:00.000Z' },
  );
  assert.deepEqual(
    ripleySyncWindow({ date: '2026-08-20' }),
    { startDate: '2026-08-20T05:00:00.000Z', endDate: '2026-08-21T05:00:00.000Z' },
  );
});

test('mapea el ciclo de estados Mirakl al modelo canónico', () => {
  assert.deepEqual(mapRipleyCanonicalStatus('WAITING_ACCEPTANCE'), { orderStatus: 'new', fulfillmentStatus: 'pending' });
  assert.deepEqual(mapRipleyCanonicalStatus('SHIPPING'), { orderStatus: 'confirmed', fulfillmentStatus: 'ready_to_ship' });
  assert.deepEqual(mapRipleyCanonicalStatus('SHIPPED'), { orderStatus: 'confirmed', fulfillmentStatus: 'shipped' });
  assert.deepEqual(mapRipleyCanonicalStatus('RECEIVED'), { orderStatus: 'completed', fulfillmentStatus: 'delivered' });
  assert.deepEqual(mapRipleyCanonicalStatus('CANCELED'), { orderStatus: 'cancelled', fulfillmentStatus: 'cancelled' });
});

test('normaliza líneas, dirección y tracking de una orden Ripley', () => {
  const raw = {
    shipping_type_code: 'HOME_DELIVERY',
    shipping_tracking: 'TRACK-1',
    customer: { shipping_address: { street_1: 'Av. Lima 1', street_2: 'Dpto. 2', city: 'Lima', state: 'Lima' } },
    order_lines: [{ order_line_id: 'L-1', offer_sku: 'SELLER-1', product_sku: 'RIP-1', product_title: 'Producto', quantity: 2, price_unit: '10.5', total_price: '21', order_line_state: 'SHIPPING' }],
  };
  assert.deepEqual(mapRipleyShipping(raw), {
    type: 'HOME_DELIVERY', address: 'Av. Lima 1, Dpto. 2', city: 'Lima', region: 'Lima',
    trackingCode: 'TRACK-1', trackingUrl: '',
  });
  assert.deepEqual(mapRipleyOrderItems(raw)[0], {
    externalItemId: 'L-1', sku: 'SELLER-1', providerSku: 'RIP-1', description: 'Producto',
    quantity: 2, unitPrice: 10.5, discountAmount: null, total: 21, providerStatus: 'SHIPPING',
    metadata: { categoryCode: '', categoryLabel: '' }, rawData: raw.order_lines[0],
  });
});

test('sincroniza solo empresas activas con API key de Ripley y aísla fallos', async () => {
  const calls = [];
  const result = await syncAllRipleyOrders({ date: '2026-08-20' }, {
    listCompanies: async () => [
      { id: 1, activo: true, ripleyApiKey: 'key', nombre: 'Seller 1' },
      { id: 2, activo: true, ripleyApiKey: '', nombre: 'Sin key' },
      { id: 3, activo: false, ripleyApiKey: 'key', nombre: 'Inactivo' },
      { id: 4, activo: true, ripleyApiKey: 'key', nombre: 'Seller 4' },
    ],
    syncOrders: async (companyId, options) => {
      calls.push([companyId, options]);
      if (companyId === 4) throw new Error('Ripley no disponible');
      return { received: 2 };
    },
  });
  assert.deepEqual(calls, [[1, { date: '2026-08-20' }], [4, { date: '2026-08-20' }]]);
  assert.equal(result.stores, 2);
  assert.equal(result.successful, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.results[1].error, 'Ripley no disponible');
});

test('un pedido Ripley sin líneas no se marca completo y se reconsulta por order_ids', async () => {
  assert.equal(mapRipleyOrderItems({ order_id: 'RIP-EMPTY' }).length, 0);
  const queries = [];
  const ingested = [];
  const db = {
    async query(sql, params = []) {
      queries.push({ sql: String(sql), params });
      if (String(sql).includes('from orders o')) {
        if (queries.filter((entry) => entry.sql.includes('from orders o')).length > 1) {
          return { rows: [] };
        }
        return { rows: [{ external_order_id: 'RIP-EMPTY' }, { external_order_id: 'RIP-OK' }] };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  const result = await drainMissingRipleyOrderItems(4, { since: '2026-05-01T05:00:00.000Z' }, {
    db,
    getCompany: async () => ({ id: 4, activo: true, ripleyApiKey: 'key', nombre: 'LIMBO' }),
    account: { id: 8, companyId: 4 },
    ingestRipleyOrder: async (input) => {
      ingested.push(input.normalized.orderId);
      return { itemsPending: true };
    },
    client: {
      async listAllOrders({ orderIds }) {
        assert.deepEqual(orderIds, ['RIP-EMPTY', 'RIP-OK']);
        return [
          { orderId: 'RIP-EMPTY', raw: { order_id: 'RIP-EMPTY' } },
          {
            orderId: 'RIP-OK',
            raw: { order_id: 'RIP-OK', order_lines: [{ order_line_id: 'L-1', offer_sku: 'S119266', quantity: 1 }] },
          },
        ];
      },
    },
  });
  assert.equal(ingested.join(','), 'RIP-EMPTY,RIP-OK');
  assert.equal(result.candidates, 2);
  assert.equal(result.hydrated, 1);
  assert.equal(result.stillEmpty, 1);
});
