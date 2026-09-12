import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mapRipleyCanonicalStatus,
  mapRipleyOrderItems,
  remapPersistedRipleyReadyOrders,
  closeStaleRipleyShippedFulfillment,
  resolveRipleyIngestStatuses,
} from './ripley.js';

const raw = {
  order_id: 'RIP-100',
  order_reference_for_seller: 'R-100',
  order_state: 'SHIPPING',
  created_date: '2026-08-20T10:00:00Z',
  last_updated_date: '2026-08-20T12:00:00Z',
  shipping_deadline: '2026-08-22T05:00:00Z',
  currency_iso_code: 'PEN',
  total_price: 129.9,
  shipping_price: 9.9,
  customer: {
    firstname: 'Ana', lastname: 'Pérez', email: 'ana@example.com', phone: '999111222',
    shipping_address: { street_1: 'Av. Lima 123', city: 'Lima', state: 'Lima', zip_code: '15001' },
  },
  shipping_carrier_code: 'URBANO',
  shipping_tracking: 'TRACK-1',
  order_lines: [{
    order_line_id: 'LINE-1', offer_sku: 'SELLER-1', product_sku: 'RIP-1',
    product_title: 'Producto', quantity: 2, price: 60, total_price: 120,
    order_line_state: 'SHIPPING',
  }],
};

test('Mirakl SHIPPING es pendiente de preparar, no listo para enviar', () => {
  assert.deepEqual(mapRipleyCanonicalStatus('SHIPPING'), {
    orderStatus: 'confirmed', fulfillmentStatus: 'pending',
  });
  assert.deepEqual(mapRipleyCanonicalStatus('WAITING_DEBIT'), {
    orderStatus: 'confirmed', fulfillmentStatus: 'pending',
  });
  assert.deepEqual(mapRipleyCanonicalStatus('WAITING_DEBIT_PAYMENT'), {
    orderStatus: 'confirmed', fulfillmentStatus: 'pending',
  });
  assert.deepEqual(mapRipleyCanonicalStatus('NUEVO_ESTADO'), {
    orderStatus: 'confirmed', fulfillmentStatus: 'pending',
  });
  assert.deepEqual(resolveRipleyIngestStatuses('SHIPPING', {
    metadata: { ripleySvc: { statusManagement: 'TO_PICKUP' } },
  }), { orderStatus: 'confirmed', fulfillmentStatus: 'pending' });
});

test('mapea líneas Mirakl con los SKU del seller y del canal', () => {
  assert.deepEqual(mapRipleyOrderItems(raw)[0], {
    externalItemId: 'LINE-1',
    sku: 'SELLER-1',
    providerSku: 'RIP-1',
    description: 'Producto',
    quantity: 2,
    unitPrice: 60,
    discountAmount: null,
    total: 120,
    providerStatus: 'SHIPPING',
    metadata: { categoryCode: '', categoryLabel: '', imageUrl: null },
    rawData: raw.order_lines[0],
  });
});

test('reconcilia SHIPPING usando Mirakl incluso con metadata SVC antigua', async () => {
  const updates = [];
  const db = {
    async query(sql, params = []) {
      if (sql.includes('from orders o')) {
        return {
          rows: [
            { id: 11, provider_status: 'SHIPPING', fulfillment_status: 'ready_to_ship', metadata: {} },
            {
              id: 12,
              provider_status: 'SHIPPING',
              fulfillment_status: 'ready_to_ship',
              metadata: { ripleySvc: { statusManagement: 'TO_PICKUP' } },
            },
            { id: 13, provider_status: 'READY_TO_SHIP', fulfillment_status: 'ready_to_ship', metadata: {} },
          ],
        };
      }
      updates.push({ sql, params });
      return { rowCount: 1 };
    },
  };
  const result = await remapPersistedRipleyReadyOrders(db);
  assert.equal(result.updated, 2);
  assert.deepEqual(updates, [{
    sql: updates[0]?.sql,
    params: [11, 'pending'],
  }, { sql: updates[1]?.sql, params: [12, 'pending'] }]);
  assert.match(updates[0].sql, /fulfillment_status = \$2/);
});

test('no cierra un Ripley SHIPPING: sigue siendo por preparar', async () => {
  const updates = [];
  const result = await closeStaleRipleyShippedFulfillment({
    async query(sql, params = []) {
      if (sql.includes('from orders o')) {
        return { rows: [{ id: 14, provider_status: 'SHIPPING', fulfillment_status: 'pending', metadata: {} }] };
      }
      updates.push({ sql, params });
      return { rowCount: 1 };
    },
  });
  assert.equal(result.updated, 0);
  assert.deepEqual(updates, []);
});

test('guarda la foto de product_medias en la línea Ripley', () => {
  const line = mapRipleyOrderItems({
    order_lines: [{
      ...raw.order_lines[0],
      product_medias: [{ media_url: 'https://home.ripley.com.pe/desk.jpg', type: 'SMALL' }],
    }],
  })[0];
  assert.equal(line.metadata.imageUrl, 'https://home.ripley.com.pe/desk.jpg');
});
