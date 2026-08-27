import test from 'node:test';
import assert from 'node:assert/strict';
import { SHIPPING_CARRIERS, shippingCarrierLabel } from './shipping-carrier.ts';

test('shipping carriers include Movilidad propia', () => {
  assert.deepEqual(SHIPPING_CARRIERS.map((carrier) => carrier.label), [
    'Marvisuar',
    'Shaloom',
    'Dinsides',
    'Movilidad propia',
  ]);
});

test('shipping carrier labels resolve known values and ignore blanks', () => {
  assert.equal(shippingCarrierLabel('marvisuar'), 'Marvisuar');
  assert.equal(shippingCarrierLabel('shaloom'), 'Shaloom');
  assert.equal(shippingCarrierLabel('dinsides'), 'Dinsides');
  assert.equal(shippingCarrierLabel('movilidad_propia'), 'Movilidad propia');
  assert.equal(shippingCarrierLabel(''), '');
  assert.equal(shippingCarrierLabel(null), '');
  assert.equal(shippingCarrierLabel('otro'), '');
});
