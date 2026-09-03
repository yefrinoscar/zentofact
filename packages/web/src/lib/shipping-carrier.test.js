import test from 'node:test';
import assert from 'node:assert/strict';
import { SHIPPING_CARRIERS, isSellerPricedShipping, shippingCarrierLabel } from './shipping-carrier.ts';

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

test('Marvisuar, Shaloom y Dinsides cobran el precio que pone el vendedor', () => {
  assert.equal(isSellerPricedShipping('marvisuar'), true);
  assert.equal(isSellerPricedShipping('Shaloom'), true);
  assert.equal(isSellerPricedShipping('dinsides'), true);
  assert.equal(isSellerPricedShipping('nosotros'), false);
  assert.equal(isSellerPricedShipping(''), false);
  assert.equal(isSellerPricedShipping(null), false);
});
