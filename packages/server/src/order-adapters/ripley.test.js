import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mapRipleyCanonicalStatus,
  mapRipleyOrder,
  mapRipleyOrderItems,
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

test('mapea estados Ripley conocidos y conserva los desconocidos como sin mapear', () => {
  assert.deepEqual(mapRipleyCanonicalStatus('SHIPPING'), {
    orderStatus: 'confirmed', fulfillmentStatus: 'ready_to_ship',
  });
  assert.deepEqual(mapRipleyCanonicalStatus('NUEVO_ESTADO'), {
    orderStatus: 'confirmed', fulfillmentStatus: 'unmapped',
  });
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
    taxAmount: null,
    total: 120,
    providerStatus: 'SHIPPING',
    metadata: {},
    rawData: raw.order_lines[0],
  });
});

test('mapea cabecera, cliente, envío, totales e integridad de items', () => {
  const mapped = mapRipleyOrder({ raw, orderId: 'RIP-100', orderNumber: 'R-100' });
  assert.equal(mapped.externalOrderId, 'RIP-100');
  assert.equal(mapped.customer.name, 'Ana Pérez');
  assert.equal(mapped.shipping.address, 'Av. Lima 123');
  assert.equal(mapped.shipping.trackingCode, 'TRACK-1');
  assert.equal(mapped.itemsComplete, true);
  assert.equal(mapped.items.length, 1);
  assert.equal(mapped.total, 129.9);
});
