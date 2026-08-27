import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_DISTANCE_AMOUNT,
  OWN_FLEET_ORIGIN,
  PROVINCE_DEPARTMENT_AMOUNT,
  applyOwnFleetShipping,
  distanceAmountForKm,
  quoteOwnFleetShipping,
} from './own-fleet-shipping.js';

test('applyOwnFleetShipping recalcula distrito, distancia y total', () => {
  const quoted = applyOwnFleetShipping({
    subtotal: 250,
    total: 250,
    shippingAmount: null,
    shipping: {
      type: 'envio',
      carrier: 'nosotros',
      district: 'San Miguel',
      province: 'Lima',
      department: 'Lima',
      lat: OWN_FLEET_ORIGIN.lat,
      lng: OWN_FLEET_ORIGIN.lng,
    },
  });
  assert.equal(quoted.shipping.districtAmount, 8);
  assert.equal(quoted.shipping.distanceAmount, 10);
  assert.equal(quoted.shippingAmount, 18);
  assert.equal(quoted.total, 268);
});

test('applyOwnFleetShipping no altera un repartidor tercero', () => {
  const order = {
    subtotal: 250,
    total: 250,
    shippingAmount: null,
    shipping: { type: 'envio', carrier: 'shaloom' },
  };
  assert.equal(applyOwnFleetShipping(order), order);
});

test('una provincia lejana queda en el tope de distancia', () => {
  const quote = quoteOwnFleetShipping({
    district: 'Cercado',
    province: 'Arequipa',
    department: 'Arequipa',
    lat: -16.409,
    lng: -71.537,
  });
  assert.equal(quote.districtAmount, PROVINCE_DEPARTMENT_AMOUNT);
  assert.equal(quote.distanceAmount, MAX_DISTANCE_AMOUNT);
  assert.equal(quote.zone.kind, 'department');
  assert.ok(quote.distanceKm > 25);
  assert.equal(distanceAmountForKm(quote.distanceKm), MAX_DISTANCE_AMOUNT);
});
