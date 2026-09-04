import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ingestRipleyOrder,
  mapRipleyCanonicalStatus,
  mapRipleyOrderItems,
  mapRipleyShipping,
  shouldEnqueueRipleyStockJob,
  withRipleyOrderLines,
} from './order-adapters/ripley.js';
import { INVENTORY_LISTEN_FROM_AT } from './catalog/stock-commitment.js';
import { ripleySyncWindow, syncAllRipleyOrders } from './ripley-orders.js';

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

test('encola descuento de Ripley desde el corte y no marca vacío como completo', async () => {
  const afterCutoff = new Date(Date.parse(INVENTORY_LISTEN_FROM_AT) + 60_000).toISOString();
  assert.equal(shouldEnqueueRipleyStockJob({
    fulfillmentStatus: 'pending',
    orderedAt: afterCutoff,
  }), true);
  assert.equal(shouldEnqueueRipleyStockJob({
    fulfillmentStatus: 'ready_to_ship',
    orderedAt: afterCutoff,
  }), true);
  assert.equal(shouldEnqueueRipleyStockJob({
    fulfillmentStatus: 'pending',
    orderedAt: '2026-09-02T22:27:00.000Z',
  }), false);
  assert.equal(shouldEnqueueRipleyStockJob({
    fulfillmentStatus: 'cancelled',
    orderedAt: afterCutoff,
  }), false);

  const enqueued = [];
  let ingestPayload = null;
  await ingestRipleyOrder({
    companyId: 2,
    source: 'sync',
    account: { id: 9, channelCode: 'ripley' },
    normalized: {
      orderId: 'R-TODAY',
      orderNumber: 'RP-88821',
      status: 'SHIPPING',
      createdAt: afterCutoff,
      raw: {
        order_lines: [{
          order_line_id: 'L-1', offer_sku: 'S166285', product_sku: 'HOG025',
          product_title: 'Silla evolutiva', quantity: 1, price_unit: 10, total_price: 10,
        }],
      },
    },
  }, null, {
    ingest: async (input) => {
      ingestPayload = input;
      return {
        order: {
          id: 501,
          companyId: 2,
          externalOrderId: 'R-TODAY',
          externalOrderNumber: 'RP-88821',
          fulfillmentStatus: 'ready_to_ship',
          orderedAt: afterCutoff,
        },
      };
    },
    enqueue: async (input) => {
      enqueued.push(input);
      return { enqueued: true };
    },
  });

  assert.equal(ingestPayload.itemsComplete, true);
  assert.equal(ingestPayload.catalogInventoryEnabled, false);
  assert.equal(ingestPayload.items[0].sku, 'S166285');
  assert.deepEqual(enqueued, [{
    orderId: 501,
    companyId: 2,
    externalOrderId: 'R-TODAY',
    orderNumber: 'RP-88821',
    source: 'sync',
  }]);

  const empty = await ingestRipleyOrder({
    companyId: 2,
    account: { id: 9, channelCode: 'ripley' },
    normalized: { orderId: 'R-EMPTY', orderNumber: 'RP-EMPTY', status: 'SHIPPING', createdAt: afterCutoff, raw: {} },
  }, null, {
    ingest: async (input) => {
      ingestPayload = input;
      return { order: { id: 502, fulfillmentStatus: 'ready_to_ship', orderedAt: afterCutoff } };
    },
    enqueue: async () => ({ enqueued: true }),
  });
  assert.equal(ingestPayload.itemsComplete, false);
  assert.equal(empty.order.id, 502);
});

test('pide a Ripley las líneas si el listado llega sin order_lines', async () => {
  const listed = { orderId: 'R-1', raw: { order_id: 'R-1' } };
  const detailed = {
    orderId: 'R-1',
    raw: { order_id: 'R-1', order_lines: [{ order_line_id: 'L-1', offer_sku: 'S166285' }] },
  };
  const calls = [];
  const hydrated = await withRipleyOrderLines({
    async listOrders(options) {
      calls.push(options);
      return { orders: [detailed] };
    },
  }, listed);
  assert.deepEqual(calls, [{ orderIds: ['R-1'], max: 1 }]);
  assert.equal(hydrated.raw.order_lines[0].offer_sku, 'S166285');
  const already = await withRipleyOrderLines({
    async listOrders() { throw new Error('no debe pedir de nuevo'); },
  }, detailed);
  assert.equal(already, detailed);
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
