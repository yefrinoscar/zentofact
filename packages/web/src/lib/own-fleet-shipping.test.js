import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DISTANCE_TIERS,
  MAX_DISTANCE_AMOUNT,
  OWN_FLEET_ORIGIN,
  PROVINCE_DEPARTMENT_AMOUNT,
  distanceAmountForKm,
  haversineKm,
  peruPlaceFromComponents,
  quoteOwnFleetShipping,
  resolveShippingZone,
  saleTotals,
} from './own-fleet-shipping.ts';

test('los tramos de distancia son 10, 20 y 25 con tope', () => {
  assert.deepEqual(DISTANCE_TIERS.map((tier) => [tier.maxKm, tier.amount]), [
    [10, 10],
    [15, 20],
    [25, 25],
  ]);
  assert.equal(distanceAmountForKm(0), 10);
  assert.equal(distanceAmountForKm(10), 10);
  assert.equal(distanceAmountForKm(10.01), 20);
  assert.equal(distanceAmountForKm(15), 20);
  assert.equal(distanceAmountForKm(15.01), 25);
  assert.equal(distanceAmountForKm(25), 25);
  assert.equal(distanceAmountForKm(80), MAX_DISTANCE_AMOUNT);
});

test('Lima Metropolitana cobra por distrito y una provincia cobra por departamento', () => {
  assert.deepEqual(resolveShippingZone({
    district: 'Santiago de Surco',
    province: 'Lima',
    department: 'Lima',
  }), {
    zone: { kind: 'lima_district', name: 'Santiago De Surco' },
    amount: 16,
  });
  assert.equal(resolveShippingZone({
    district: 'Surco',
    province: 'Lima',
    department: 'Lima',
  }).amount, 16);
  assert.equal(resolveShippingZone({
    district: 'San Miguel',
    province: 'Lima',
    department: 'Lima',
  }).amount, 8);
  assert.deepEqual(resolveShippingZone({
    district: 'Huaral',
    province: 'Huaral',
    department: 'Lima',
  }), {
    zone: { kind: 'department', name: 'Lima' },
    amount: PROVINCE_DEPARTMENT_AMOUNT,
  });
  assert.deepEqual(resolveShippingZone({
    district: 'Cercado',
    province: 'Arequipa',
    department: 'Arequipa',
  }), {
    zone: { kind: 'department', name: 'Arequipa' },
    amount: PROVINCE_DEPARTMENT_AMOUNT,
  });
  assert.equal(resolveShippingZone({
    district: 'Ventanilla',
    province: 'Callao',
    department: 'Callao',
  }).amount, 18);
});

test('no trata la provincia Lima como Cercado cuando falta el distrito', () => {
  assert.deepEqual(resolveShippingZone({
    district: '',
    province: 'Lima',
    department: 'Lima',
  }), {
    zone: { kind: 'department', name: 'Lima' },
    amount: PROVINCE_DEPARTMENT_AMOUNT,
  });
});

test('peruPlaceFromComponents extrae distrito limeño y departamento de provincia', () => {
  assert.deepEqual(peruPlaceFromComponents([
    { long_name: 'Santiago de Surco', types: ['sublocality_level_1', 'sublocality'] },
    { long_name: 'Lima', types: ['locality'] },
    { long_name: 'Lima', types: ['administrative_area_level_2'] },
    { long_name: 'Lima', types: ['administrative_area_level_1'] },
  ]), {
    district: 'Santiago De Surco',
    province: 'Lima',
    department: 'Lima',
  });
  assert.deepEqual(peruPlaceFromComponents([
    { longText: 'Arequipa', types: ['locality'] },
    { longText: 'Arequipa', types: ['administrative_area_level_2'] },
    { longText: 'Arequipa', types: ['administrative_area_level_1'] },
  ]), {
    district: 'Arequipa',
    province: 'Arequipa',
    department: 'Arequipa',
  });
});

test('la cotización suma distrito y distancia desde La Marina', () => {
  const atWarehouse = quoteOwnFleetShipping({
    district: 'San Miguel',
    province: 'Lima',
    department: 'Lima',
    lat: OWN_FLEET_ORIGIN.lat,
    lng: OWN_FLEET_ORIGIN.lng,
  });
  assert.equal(atWarehouse?.districtAmount, 8);
  assert.equal(atWarehouse?.distanceKm, 0);
  assert.equal(atWarehouse?.distanceAmount, 10);
  assert.equal(atWarehouse?.total, 18);

  const surco = quoteOwnFleetShipping({
    district: 'Surco',
    province: 'Lima',
    department: 'Lima',
    lat: -12.135,
    lng: -76.995,
  });
  const km = haversineKm(OWN_FLEET_ORIGIN, { lat: -12.135, lng: -76.995 });
  assert.ok(km > 10 && km <= 15, `Surco debería caer en el tramo de 15 km, km=${km}`);
  assert.equal(surco?.districtAmount, 16);
  assert.equal(surco?.distanceAmount, 20);
  assert.equal(surco?.total, 36);
  assert.equal(surco?.zoneLabel, 'Surco');
});

test('saleTotals agrega productos, distrito y distancia al total', () => {
  assert.deepEqual(saleTotals(250, {
    charged: true,
    zone: { kind: 'lima_district', name: 'Surco' },
    zoneLabel: 'Surco',
    districtAmount: 16,
    distanceKm: 12,
    distanceAmount: 20,
    total: 36,
  }), {
    products: 250,
    districtAmount: 16,
    distanceAmount: 20,
    shipping: 36,
    total: 286,
  });
  assert.deepEqual(saleTotals(250, null), {
    products: 250,
    districtAmount: 0,
    distanceAmount: 0,
    shipping: 0,
    total: 250,
  });
});
