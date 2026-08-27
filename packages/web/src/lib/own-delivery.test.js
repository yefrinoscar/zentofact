import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_DELIVERY_LOCATION,
  LIMA_METROPOLITAN_DISTRICTS,
  districtsForDeliveryLocation,
  findLimaMetropolitanDistrict,
  ownDeliveryQuote,
} from './own-delivery.ts';

test('la cobertura propia incluye los 43 distritos de la provincia de Lima', () => {
  assert.equal(DEFAULT_DELIVERY_LOCATION.department, 'Lima');
  assert.equal(DEFAULT_DELIVERY_LOCATION.province, 'Lima');
  assert.equal(LIMA_METROPOLITAN_DISTRICTS.length, 43);
  assert.equal(districtsForDeliveryLocation(DEFAULT_DELIVERY_LOCATION).length, 43);
  assert.equal(findLimaMetropolitanDistrict('Surco')?.name, 'Santiago de Surco');
  assert.equal(findLimaMetropolitanDistrict('Villa María del Triunfo')?.ubigeo, '150143');
  assert.equal(findLimaMetropolitanDistrict('San Juan'), null);
});

test('la tarifa propia aplica el tramo por distancia y detiene la cobertura en 25 km', () => {
  assert.deepEqual(ownDeliveryQuote(10), { distanceKm: 10, maxDistanceKm: 10, amount: 10 });
  assert.deepEqual(ownDeliveryQuote(10.1), { distanceKm: 10.1, maxDistanceKm: 15, amount: 20 });
  assert.deepEqual(ownDeliveryQuote(25), { distanceKm: 25, maxDistanceKm: 25, amount: 25 });
  assert.equal(ownDeliveryQuote(25.1), null);
  assert.equal(ownDeliveryQuote(0), null);
});
