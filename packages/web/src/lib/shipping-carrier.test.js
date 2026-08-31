import test from 'node:test';
import assert from 'node:assert/strict';
import { SHIPPING_CARRIERS, shippingCarrierLabel } from './shipping-carrier.ts';

test('shipping carriers are Marvisuar, Shaloom, Dinsides and Express', () => {
  assert.deepEqual(SHIPPING_CARRIERS.map((carrier) => carrier.label), [
    'Marvisuar',
    'Shaloom',
    'Dinsides',
    'Express',
  ]);
});

test('el reparto propio se muestra como Express pero se guarda como nosotros', () => {
  const ownFleet = SHIPPING_CARRIERS.find((carrier) => carrier.label === 'Express');
  assert.equal(ownFleet.value, 'nosotros');
});

test('shipping carrier labels resolve known values and ignore blanks', () => {
  assert.equal(shippingCarrierLabel('marvisuar'), 'Marvisuar');
  assert.equal(shippingCarrierLabel('shaloom'), 'Shaloom');
  assert.equal(shippingCarrierLabel('dinsides'), 'Dinsides');
  assert.equal(shippingCarrierLabel('nosotros'), 'Express');
  assert.equal(shippingCarrierLabel(''), '');
  assert.equal(shippingCarrierLabel(null), '');
  assert.equal(shippingCarrierLabel('otro'), '');
});
