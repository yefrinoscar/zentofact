import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ingestRipleyOrder,
  mapRipleyCanonicalStatus,
  mapRipleyShipmentFulfillmentStatus,
  mapRipleyOrderItems,
  mapRipleyShipping,
  remapPersistedRipleyReadyOrders,
  resolveRipleyIngestStatuses,
  shouldEnqueueRipleyStockJob,
  withRipleyOrderLines,
} from './order-adapters/ripley.js';
import { INVENTORY_LISTEN_FROM_AT } from './catalog/stock-commitment.js';
import { ripleyShipmentStatuses } from './order-sync.js';

test('mapea el ciclo de estados Mirakl al modelo canónico', () => {
  assert.deepEqual(mapRipleyCanonicalStatus('WAITING_ACCEPTANCE'), { orderStatus: 'new', fulfillmentStatus: 'pending' });
  assert.deepEqual(mapRipleyCanonicalStatus('SHIPPING'), { orderStatus: 'confirmed', fulfillmentStatus: 'preparing' });
  assert.deepEqual(mapRipleyCanonicalStatus('WAITING_DEBIT'), { orderStatus: 'confirmed', fulfillmentStatus: 'pending' });
  assert.deepEqual(mapRipleyCanonicalStatus('SHIPPED'), { orderStatus: 'confirmed', fulfillmentStatus: 'shipped' });
  assert.deepEqual(mapRipleyCanonicalStatus('RECEIVED'), { orderStatus: 'completed', fulfillmentStatus: 'delivered' });
  assert.deepEqual(mapRipleyCanonicalStatus('CANCELED'), { orderStatus: 'cancelled', fulfillmentStatus: 'cancelled' });
});

test('ST11 separa un shipment en preparación de uno listo para recojo', () => {
  assert.equal(mapRipleyShipmentFulfillmentStatus('SHIPPING'), 'preparing');
  assert.equal(mapRipleyShipmentFulfillmentStatus('SHIPMENT_PREPARED'), 'preparing');
  assert.equal(mapRipleyShipmentFulfillmentStatus('READY_FOR_PICK_UP'), 'ready_to_ship');
  assert.equal(mapRipleyShipmentFulfillmentStatus('SHIPPED'), 'shipped');
  assert.equal(mapRipleyShipmentFulfillmentStatus('TO_COLLECT'), 'shipped');
  assert.equal(mapRipleyShipmentFulfillmentStatus('RECEIVED'), 'delivered');
  assert.equal(mapRipleyShipmentFulfillmentStatus('CANCELED'), 'cancelled');
  assert.equal(mapRipleyShipmentFulfillmentStatus('CLOSED'), 'delivered');
});

test('obtiene de ST11 el estado más reciente de cada orden', async () => {
  const statuses = await ripleyShipmentStatuses({
    async listAllShipments({ orderIds }) {
      assert.deepEqual(orderIds, ['R-1', 'R-2']);
      return [
        { orderId: 'R-1', status: 'SHIPPING', updatedAt: '2026-09-12T10:00:00Z' },
        { orderId: 'R-1', status: 'READY_FOR_PICK_UP', updatedAt: '2026-09-12T11:00:00Z' },
        { orderId: 'R-2', status: 'SHIPPED', updatedAt: '2026-09-12T12:00:00Z' },
      ];
    },
  }, ['R-1', 'R-2']);
  assert.deepEqual(Object.fromEntries(statuses), {
    'R-1': { status: 'READY_FOR_PICK_UP', updatedAt: '2026-09-12T11:00:00Z' },
    'R-2': { status: 'SHIPPED', updatedAt: '2026-09-12T12:00:00Z' },
  });
});

test('ST11 tiene prioridad para el estado operativo de un SHIPPING de OR11', () => {
  assert.deepEqual(resolveRipleyIngestStatuses('SHIPPING'), {
    orderStatus: 'confirmed', fulfillmentStatus: 'preparing',
  });
  assert.deepEqual(resolveRipleyIngestStatuses('SHIPPING', null, 'READY_FOR_PICK_UP'), {
    orderStatus: 'confirmed', fulfillmentStatus: 'ready_to_ship',
  });
  assert.deepEqual(resolveRipleyIngestStatuses('SHIPPING', null, 'SHIPPED'), {
    orderStatus: 'confirmed', fulfillmentStatus: 'shipped',
  });
  assert.deepEqual(resolveRipleyIngestStatuses('SHIPPING', {
    fulfillment_status: 'ready_to_ship',
    metadata: {},
  }), { orderStatus: 'confirmed', fulfillmentStatus: 'preparing' });
  assert.deepEqual(resolveRipleyIngestStatuses('SHIPPING', {
    metadata: { ripleySvc: { statusManagement: 'TO_PREPARE' } },
  }), { orderStatus: 'confirmed', fulfillmentStatus: 'preparing' });
  assert.deepEqual(resolveRipleyIngestStatuses('SHIPPING', {
    metadata: { ripleySvc: { statusManagement: 'TO_PICKUP' } },
  }), { orderStatus: 'confirmed', fulfillmentStatus: 'preparing' });
  assert.deepEqual(resolveRipleyIngestStatuses('SHIPPED', {
    metadata: { ripleySvc: { statusManagement: 'TO_PICKUP' } },
  }), { orderStatus: 'confirmed', fulfillmentStatus: 'shipped' });
  assert.deepEqual(resolveRipleyIngestStatuses('CANCELED', {
    metadata: { ripleySvc: { statusManagement: 'TO_PICKUP' } },
  }), { orderStatus: 'cancelled', fulfillmentStatus: 'cancelled' });
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
    metadata: { categoryCode: '', categoryLabel: '', imageUrl: null }, rawData: raw.order_lines[0],
  });
});

test('toma la foto Ripley de product_medias', () => {
  const items = mapRipleyOrderItems({
    order_lines: [{
      order_line_id: 'L-2', offer_sku: 'S793615', product_sku: 'P-99',
      product_title: 'Escritorio gamer', quantity: 1, price_unit: '399', total_price: '399',
      order_line_state: 'SHIPPING',
      product_medias: [{ media_url: 'https://home.ripley.com.pe/desk.jpg', type: 'SMALL' }],
    }],
  });
  assert.equal(items[0].metadata.imageUrl, 'https://home.ripley.com.pe/desk.jpg');
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

  assert.equal(ingestPayload.fulfillmentStatus, 'preparing');
  assert.equal(ingestPayload.providerStatus, 'SHIPPING');
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
  assert.equal(ingestPayload.fulfillmentStatus, 'preparing');
  assert.equal(ingestPayload.itemsComplete, false);
  assert.equal(empty.order.id, 502);
});

test('el ingest usa SHIPPING de Mirakl aunque exista metadata SVC antigua', async () => {
  let ingestPayload = null;
  const db = {
    async query(sql, params) {
      assert.match(sql, /from orders/);
      assert.deepEqual(params, [9, 'R-KEEP']);
      return {
        rows: [{
          fulfillment_status: 'ready_to_ship',
          metadata: { ripleySvc: { statusManagement: 'TO_PICKUP' } },
        }],
      };
    },
  };
  await ingestRipleyOrder({
    companyId: 2,
    account: { id: 9, channelCode: 'ripley' },
    normalized: { orderId: 'R-KEEP', orderNumber: 'RP-KEEP', status: 'SHIPPING', raw: {} },
  }, db, {
    ingest: async (input) => {
      ingestPayload = input;
      return { order: { id: 9, fulfillmentStatus: input.fulfillmentStatus } };
    },
    enqueue: async () => ({ enqueued: false }),
  });
  assert.equal(ingestPayload.fulfillmentStatus, 'preparing');
});

test('el ingest de SHIPPING corrige un listo persistido sin evidencia de ST11', async () => {
  let ingestPayload = null;
  await ingestRipleyOrder({
    companyId: 2,
    account: { id: 9, channelCode: 'ripley' },
    normalized: { orderId: 'R-FIX', orderNumber: 'RP-FIX', status: 'SHIPPING', raw: {} },
  }, {
    async query() {
      return { rows: [{ fulfillment_status: 'ready_to_ship', metadata: {} }] };
    },
  }, {
    ingest: async (input) => {
      ingestPayload = input;
      return { order: { id: 10, fulfillmentStatus: input.fulfillmentStatus } };
    },
    enqueue: async () => ({ enqueued: false }),
  });
  assert.equal(ingestPayload.fulfillmentStatus, 'preparing');
});

test('no baja un listo que ST11 confirmó para retiro', async () => {
  const updates = [];
  const result = await remapPersistedRipleyReadyOrders({
    async query(sql, params) {
      if (sql.startsWith('select')) {
        return {
          rows: [
            { id: 11, provider_status: 'SHIPPING', metadata: {} },
            {
              id: 12,
              provider_status: 'SHIPPING',
              metadata: { miraklShipmentStatus: 'READY_FOR_PICK_UP' },
            },
          ],
        };
      }
      updates.push(params);
      return { rowCount: 1 };
    },
  }, 9);

  assert.deepEqual(updates, [[11, 'preparing']]);
  assert.equal(result.updated, 1);
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
