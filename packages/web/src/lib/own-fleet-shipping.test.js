import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DISTANCE_TIERS,
  MAX_DISTANCE_AMOUNT,
  METRO_POINTS,
  OWN_FLEET_ORIGIN,
  PROVINCE_DEPARTMENT_AMOUNT,
  countryFromComponents,
  distanceAmountForKm,
  haversineKm,
  isInPeru,
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
  assert.equal(peruPlaceFromComponents([
    { long_name: 'San Miguel', types: ['political'] },
    { long_name: 'Lima', types: ['locality'] },
    { long_name: 'Lima', types: ['administrative_area_level_2'] },
    { long_name: 'Provincia de Lima', types: ['administrative_area_level_1'] },
  ]).district, 'San Miguel');
});

test('isInPeru rechaza coordenadas o país fuera del Perú', () => {
  assert.equal(isInPeru(-12.0776, -77.0905), true);
  assert.equal(isInPeru(-16.409, -71.537), true);
  assert.equal(isInPeru(-11.739, -77.15), true);
  assert.equal(isInPeru(-12.0776, -77.0905, 'PE'), true);
  assert.equal(isInPeru(-12.0776, -77.0905, 'Perú'), true);
  assert.equal(isInPeru(40.4168, -3.7038), false);
  assert.equal(isInPeru(-34.6037, -58.3816), false);
  assert.equal(isInPeru(-3.48, -80.17, 'Ecuador'), false);
  assert.equal(isInPeru(-12.0776, -77.0905, 'Chile'), false);
  assert.equal(countryFromComponents([
    { short_name: 'PE', long_name: 'Peru', types: ['country', 'political'] },
  ]), 'PE');
  assert.equal(countryFromComponents([
    { shortName: 'CL', longName: 'Chile', types: ['country'] },
  ]), 'CL');
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
  assert.equal(surco?.zoneLabel, 'Santiago De Surco');
});

test('la cotización usa el distrito del pin, no el texto buscado', () => {
  const mislabeledSurquillo = quoteOwnFleetShipping({
    district: 'San Miguel',
    province: 'Lima',
    department: 'Lima',
    lat: -12.114,
    lng: -77.021,
  });
  assert.equal(mislabeledSurquillo?.zoneLabel, 'Surquillo');
  assert.equal(mislabeledSurquillo?.districtAmount, 12);

  const googleSaidLima = quoteOwnFleetShipping({
    district: 'Lima',
    province: 'Lima',
    department: 'Provincia De Lima',
    lat: OWN_FLEET_ORIGIN.lat,
    lng: OWN_FLEET_ORIGIN.lng,
  });
  assert.equal(googleSaidLima?.zoneLabel, 'San Miguel');
  assert.equal(googleSaidLima?.districtAmount, 8);

  const leftoverSanMiguelInArequipa = quoteOwnFleetShipping({
    district: 'San Miguel',
    province: 'Lima',
    department: 'Lima',
    lat: -16.409,
    lng: -71.537,
  });
  assert.equal(leftoverSanMiguelInArequipa?.charged, false);
  assert.equal(leftoverSanMiguelInArequipa?.zone.kind, 'out_of_range');
  assert.equal(leftoverSanMiguelInArequipa?.zoneLabel, 'Arequipa');
  assert.equal(leftoverSanMiguelInArequipa?.total, 0);

  const huaral = quoteOwnFleetShipping({
    district: 'Ancón',
    province: 'Lima',
    department: 'Lima',
    lat: -11.495,
    lng: -77.208,
  });
  assert.equal(huaral?.charged, false);
  assert.equal(huaral?.zone.kind, 'out_of_range');
  assert.equal(huaral?.zoneLabel, 'Huaral');
  assert.equal(huaral?.total, 0);

  const ancon = quoteOwnFleetShipping({
    district: 'San Miguel',
    lat: -11.739,
    lng: -77.15,
  });
  assert.equal(ancon?.charged, true);
  assert.equal(ancon?.zoneLabel, 'Ancón');
  assert.equal(ancon?.districtAmount, 20);
});

test('la movilidad propia cubre Lima metropolitana: 43 distritos y Callao', () => {
  const lima = METRO_POINTS.filter((place) => place.department === 'Lima').map((place) => place.district);
  const callao = METRO_POINTS.filter((place) => place.department === 'Callao').map((place) => place.district);
  assert.equal(lima.length, 43);
  assert.equal(callao.length, 7);
  assert.ok(lima.includes('Ancón'));
  assert.ok(lima.includes('Santa Rosa'));
  assert.ok(lima.includes('Pucusana'));
  assert.ok(callao.includes('Mi Perú'));
  assert.equal(lima.includes('Huaral'), false);
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
