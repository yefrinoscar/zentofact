import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mapMercadoLibreCanonicalStatus,
  mapMercadoLibreCustomer,
  mapMercadoLibreOrderItems,
  mapMercadoLibrePromisedShippingAt,
  mercadoLibrePaymentStatus,
  mercadoLibreRequestedDocumentType,
} from './mercadolibre.js';

test('mapea estados de envío y no trata fraude como listo para enviar', () => {
  assert.deepEqual(mapMercadoLibreCanonicalStatus({
    orderStatus: 'paid',
    shipmentStatus: 'ready_to_ship',
  }), { orderStatus: 'confirmed', fulfillmentStatus: 'ready_to_ship' });
  assert.deepEqual(mapMercadoLibreCanonicalStatus({
    orderStatus: 'paid',
    shipmentStatus: 'ready_to_ship',
    tags: ['fraud_risk_detected'],
  }), { orderStatus: 'confirmed', fulfillmentStatus: 'preparing' });
  assert.deepEqual(mapMercadoLibreCanonicalStatus({
    orderStatus: 'paid',
    shipmentStatus: 'delivered',
  }), { orderStatus: 'completed', fulfillmentStatus: 'delivered' });
  assert.deepEqual(mapMercadoLibreCanonicalStatus({
    orderStatus: 'cancelled',
    shipmentStatus: 'ready_to_ship',
  }), { orderStatus: 'cancelled', fulfillmentStatus: 'cancelled' });
  assert.deepEqual(mapMercadoLibreCanonicalStatus({
    orderStatus: 'mystery_state',
  }), { orderStatus: 'confirmed', fulfillmentStatus: 'unmapped' });
});

test('lee el SKU del pedido desde seller_sku y no desde seller_custom_field', () => {
  const items = mapMercadoLibreOrderItems({
    order_items: [{
      item: {
        id: 'MPE123',
        title: 'Silla evolutiva',
        seller_sku: 'HOG025',
        seller_custom_field: 'NOT-SKU',
      },
      quantity: 2,
      unit_price: 80,
    }],
  });
  assert.equal(items[0].sku, 'HOG025');
  assert.equal(items[0].providerSku, 'MPE123');
  assert.equal(items[0].quantity, 2);
  assert.equal(items[0].total, 160);
});

test('arma el cliente y el tipo de comprobante desde billing-info de Perú', () => {
  const billing = {
    name: 'Ana',
    lastName: 'Pérez',
    documentType: 'DNI',
    documentNumber: '12345678',
    customerType: 'CO',
  };
  const customer = mapMercadoLibreCustomer({ buyer: { nickname: 'anap' } }, billing);
  assert.equal(customer.name, 'Ana Pérez');
  assert.equal(customer.documentNumber, '12345678');
  assert.equal(mercadoLibreRequestedDocumentType(billing), 'boleta');
  assert.equal(mercadoLibreRequestedDocumentType({ documentType: 'RUC', customerType: 'BU' }), 'factura');
  assert.equal(mercadoLibrePaymentStatus('paid'), 'paid');
  const withPhoneObject = mapMercadoLibreCustomer({
    buyer: { first_name: 'Ana', phone: { number: '999111222' } },
  }, null);
  assert.equal(withPhoneObject.phone, '999111222');
});

test('el plazo de la bandeja sale del envío ME2 o del día siguiente', () => {
  assert.equal(
    mapMercadoLibrePromisedShippingAt({
      raw: { date_ready_to_ship: '2026-09-06T16:00:00.000Z' },
    }),
    '2026-09-06T16:00:00.000Z',
  );
  const fallback = mapMercadoLibrePromisedShippingAt(null, '2026-09-05T10:00:00.000Z');
  assert.equal(fallback, '2026-09-06T10:00:00.000Z');
});
