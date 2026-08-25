import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MANAGED_ORDER_TABLE_COLUMNS,
  deliveryLabel,
  deliveryShowsAsTag,
} from './managed-orders-presentation.ts';

test('la bandeja de pedidos no muestra columna de teléfono', () => {
  assert.equal(MANAGED_ORDER_TABLE_COLUMNS.includes('phone'), false);
  assert.ok(MANAGED_ORDER_TABLE_COLUMNS.includes('delivery'));
  assert.ok(MANAGED_ORDER_TABLE_COLUMNS.includes('customer'));
});

test('deliveryLabel resume recojo, repartidor, envío y marketplace', () => {
  assert.equal(deliveryLabel({ shipping: { type: 'recojo' } }), 'Recojo');
  assert.equal(deliveryLabel({ shipping: { type: 'envio', carrier: 'marvisuar' } }), 'Marvisuar');
  assert.equal(deliveryLabel({ shipping: { type: 'envio' } }), 'Envío');
  assert.equal(deliveryLabel({ channelCode: 'falabella', shipping: {} }), 'Marketplace');
  assert.equal(deliveryLabel({ channelCode: 'manual', shipping: {} }), '—');
});

test('regresión: entrega con valor operativo se presenta como tag', () => {
  assert.equal(deliveryShowsAsTag(deliveryLabel({ shipping: { type: 'recojo' } })), true);
  assert.equal(deliveryShowsAsTag(deliveryLabel({ shipping: { carrier: 'shaloom' } })), true);
  assert.equal(deliveryShowsAsTag(deliveryLabel({ channelCode: 'manual', shipping: {} })), false);
});

test('regresión: etiquetas de reparto alineadas con shipping-carrier', async () => {
  const { SHIPPING_CARRIERS } = await import('./shipping-carrier.ts');
  for (const carrier of SHIPPING_CARRIERS) {
    assert.equal(
      deliveryLabel({ shipping: { type: 'envio', carrier: carrier.value } }),
      carrier.label,
    );
  }
});
