import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_OWN_FLEET_ZONES,
  METRO_POINTS,
  OWN_FLEET_ORIGIN,
  PROVINCE_DEPARTMENT_AMOUNT,
  countryFromComponents,
  defaultOwnFleetConfig,
  haversineKm,
  isInPeru,
  mergeOwnFleetConfig,
  peruPlaceFromComponents,
  quoteOwnFleetShipping,
  resolveShippingZone,
  saleTotals,
  serializeOwnFleetConfig,
} from './own-fleet-shipping.ts';

function zoneOf(config, districtKey) {
  const district = config.districts.find((row) => row.key === districtKey);
  return config.zones.find((zone) => zone.key === district.zone);
}

test('las zonas por defecto agrupan los distritos por distancia a la bodega', () => {
  assert.deepEqual(DEFAULT_OWN_FLEET_ZONES.map((zone) => [zone.name, zone.amount]), [
    ['Cerca', 10],
    ['Media', 15],
    ['Lejos', 25],
  ]);

  const config = defaultOwnFleetConfig();
  assert.equal(config.zones.length, 3);
  assert.equal(config.districts.length, 50);
  // Todo distrito pertenece a una zona existente.
  assert.ok(config.districts.every((district) => config.zones.some((zone) => zone.key === district.zone)));
  // Y su precio es exactamente el de esa zona.
  assert.ok(config.districts.every((district) => zoneOf(config, district.key).amount === district.amount));

  assert.equal(zoneOf(config, 'san miguel').name, 'Cerca');
  assert.equal(zoneOf(config, 'surquillo').name, 'Cerca');
  assert.equal(zoneOf(config, 'santiago de surco').name, 'Media');
  assert.equal(zoneOf(config, 'ate').name, 'Media');
  assert.equal(zoneOf(config, 'lurigancho').name, 'Lejos');
  assert.equal(zoneOf(config, 'pucusana').name, 'Lejos');
});

test('cada distrito guarda su distancia a la bodega como referencia', () => {
  const config = defaultOwnFleetConfig();
  const sanMiguel = config.districts.find((row) => row.key === 'san miguel');
  const lurigancho = config.districts.find((row) => row.key === 'lurigancho');
  assert.equal(sanMiguel.distanceKm, 0);
  assert.ok(lurigancho.distanceKm > 40, `Lurigancho está lejos, km=${lurigancho.distanceKm}`);
});

test('el precio sale de la zona del distrito, no de la distancia', () => {
  assert.deepEqual(resolveShippingZone({
    district: 'Santiago de Surco',
    province: 'Lima',
    department: 'Lima',
  }), {
    zone: { kind: 'lima_district', name: 'Santiago De Surco' },
    amount: 15,
    priceZone: { key: 'media', name: 'Media', amount: 15 },
  });
  assert.equal(resolveShippingZone({ district: 'Surco', province: 'Lima', department: 'Lima' }).amount, 15);
  assert.equal(resolveShippingZone({ district: 'San Miguel', province: 'Lima', department: 'Lima' }).amount, 10);
  assert.equal(resolveShippingZone({ district: 'Ventanilla', province: 'Callao', department: 'Callao' }).amount, 25);

  assert.deepEqual(resolveShippingZone({ district: 'Huaral', province: 'Huaral', department: 'Lima' }), {
    zone: { kind: 'department', name: 'Lima' },
    amount: PROVINCE_DEPARTMENT_AMOUNT,
    priceZone: null,
  });
  assert.deepEqual(resolveShippingZone({ district: 'Cercado', province: 'Arequipa', department: 'Arequipa' }), {
    zone: { kind: 'department', name: 'Arequipa' },
    amount: PROVINCE_DEPARTMENT_AMOUNT,
    priceZone: null,
  });
});

test('no trata la provincia Lima como Cercado cuando falta el distrito', () => {
  assert.deepEqual(resolveShippingZone({
    district: '',
    province: 'Lima',
    department: 'Lima',
  }), {
    zone: { kind: 'department', name: 'Lima' },
    amount: PROVINCE_DEPARTMENT_AMOUNT,
    priceZone: null,
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

test('la cotización cobra la zona una sola vez y no recarga por distancia', () => {
  const atWarehouse = quoteOwnFleetShipping({
    district: 'San Miguel',
    province: 'Lima',
    department: 'Lima',
    lat: OWN_FLEET_ORIGIN.lat,
    lng: OWN_FLEET_ORIGIN.lng,
  });
  assert.equal(atWarehouse?.priceZoneName, 'Cerca');
  assert.equal(atWarehouse?.districtAmount, 10);
  assert.equal(atWarehouse?.distanceKm, 0);
  assert.equal(atWarehouse?.distanceAmount, 0);
  assert.equal(atWarehouse?.total, 10);

  const surco = quoteOwnFleetShipping({
    district: 'Surco',
    province: 'Lima',
    department: 'Lima',
    lat: -12.135,
    lng: -76.995,
  });
  assert.equal(surco?.priceZoneName, 'Media');
  assert.equal(surco?.districtAmount, 15);
  assert.equal(surco?.distanceAmount, 0);
  assert.equal(surco?.total, 15);
  assert.equal(surco?.zoneLabel, 'Santiago De Surco');
  // Los kilómetros se informan, no se cobran.
  assert.equal(surco?.distanceKm, Math.round(haversineKm(OWN_FLEET_ORIGIN, { lat: -12.135, lng: -76.995 }) * 100) / 100);
});

test('un destino lejano paga su zona, no un recargo proporcional', () => {
  const lurigancho = quoteOwnFleetShipping({ district: 'Lurigancho', lat: -11.937, lng: -76.709 });
  assert.equal(lurigancho?.charged, true);
  assert.equal(lurigancho?.priceZoneName, 'Lejos');
  assert.ok(lurigancho.distanceKm > 40, `Lurigancho está lejos, km=${lurigancho.distanceKm}`);
  assert.equal(lurigancho?.distanceAmount, 0);
  assert.equal(lurigancho?.total, 25);
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
  assert.equal(mislabeledSurquillo?.districtAmount, 10);

  const googleSaidLima = quoteOwnFleetShipping({
    district: 'Lima',
    province: 'Lima',
    department: 'Provincia De Lima',
    lat: OWN_FLEET_ORIGIN.lat,
    lng: OWN_FLEET_ORIGIN.lng,
  });
  assert.equal(googleSaidLima?.zoneLabel, 'San Miguel');
  assert.equal(googleSaidLima?.districtAmount, 10);

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

  const ancon = quoteOwnFleetShipping({ district: 'San Miguel', lat: -11.739, lng: -77.15 });
  assert.equal(ancon?.charged, true);
  assert.equal(ancon?.zoneLabel, 'Ancón');
  assert.equal(ancon?.districtAmount, 25);
});

test('las playas del sur no tienen envío propio hasta que el admin las encienda', () => {
  const pucusana = quoteOwnFleetShipping({ district: 'Pucusana', lat: -12.481, lng: -76.797 });
  assert.equal(pucusana?.charged, false);
  assert.equal(pucusana?.zoneLabel, 'Pucusana');

  const sanBartolo = quoteOwnFleetShipping({ district: 'San Bartolo', lat: -12.388, lng: -76.778 });
  assert.equal(sanBartolo?.charged, false);
  assert.equal(sanBartolo?.zoneLabel, 'San Bartolo');

  const enabled = mergeOwnFleetConfig({ districts: [{ key: 'pucusana', enabled: true }] });
  const quoted = quoteOwnFleetShipping({ district: 'Pucusana', lat: -12.481, lng: -76.797 }, enabled);
  assert.equal(quoted?.charged, true);
  assert.equal(quoted?.zoneLabel, 'Pucusana');
  assert.equal(quoted?.priceZoneName, 'Lejos');
  assert.equal(quoted?.districtAmount, 25);
  assert.equal(quoted?.distanceAmount, 0);

  const lurin = quoteOwnFleetShipping({ district: 'Lurín', lat: -12.274, lng: -76.87 });
  assert.equal(lurin?.charged, true);
  assert.equal(lurin?.districtAmount, 25);
});

test('el admin cambia el precio de una zona y todos sus distritos lo siguen', () => {
  const config = mergeOwnFleetConfig({
    zones: [
      { key: 'cerca', name: 'Cerca', amount: 12 },
      { key: 'media', name: 'Media', amount: 18 },
      { key: 'lejos', name: 'Lejos', amount: 30 },
    ],
  });
  assert.equal(zoneOf(config, 'san miguel').amount, 12);
  assert.equal(config.districts.find((row) => row.key === 'san miguel').amount, 12);
  assert.equal(quoteOwnFleetShipping({ district: 'San Miguel', lat: -12.0776, lng: -77.0905 }, config)?.total, 12);
});

test('el admin mueve un distrito de zona y cambia su precio', () => {
  const config = mergeOwnFleetConfig({
    districts: [{ key: 'santiago de surco', zone: 'cerca', enabled: true }],
  });
  assert.equal(zoneOf(config, 'santiago de surco').name, 'Cerca');
  assert.equal(quoteOwnFleetShipping({ district: 'Surco', lat: -12.135, lng: -76.995 }, config)?.total, 10);
});

test('una configuración vieja con precio por distrito se convierte en zonas sin perder precios', () => {
  const legacy = {
    districts: defaultOwnFleetConfig().districts.map((district) => ({
      key: district.key,
      enabled: district.enabled,
      // Precios del modelo anterior: dos grupos distintos.
      amount: district.key === 'san miguel' ? 8 : 16,
    })),
  };
  const migrated = mergeOwnFleetConfig(legacy);
  assert.deepEqual(migrated.zones.map((zone) => [zone.name, zone.amount]), [
    ['Zona 1', 8],
    ['Zona 2', 16],
  ]);
  assert.equal(migrated.districts.find((row) => row.key === 'san miguel').amount, 8);
  assert.equal(migrated.districts.find((row) => row.key === 'surquillo').amount, 16);
});

test('guardar y volver a leer la configuración no la cambia', () => {
  const config = mergeOwnFleetConfig({
    zones: [{ key: 'cerca', name: 'Cerca', amount: 12 }, { key: 'lejos', name: 'Lejos', amount: 40 }],
    districts: [{ key: 'santiago de surco', zone: 'lejos', enabled: true }],
  });
  const round = mergeOwnFleetConfig(serializeOwnFleetConfig(config));
  assert.deepEqual(round.zones, config.zones);
  assert.deepEqual(round.districts, config.districts);
  // El precio nunca se guarda por distrito: manda la zona.
  const stored = serializeOwnFleetConfig(config);
  assert.ok(stored.districts.every((district) => district.amount === undefined));
});

test('el envío propio cubre Lima metropolitana: 43 distritos y Callao', () => {
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

test('saleTotals suma productos y un único envío', () => {
  assert.deepEqual(saleTotals(250, {
    charged: true,
    zone: { kind: 'lima_district', name: 'Surco' },
    zoneLabel: 'Surco',
    priceZoneKey: 'media',
    priceZoneName: 'Media',
    districtAmount: 15,
    distanceKm: 12.19,
    distanceAmount: 0,
    total: 15,
  }), {
    products: 250,
    districtAmount: 15,
    distanceAmount: 0,
    shipping: 15,
    total: 265,
  });
  assert.deepEqual(saleTotals(250, null), {
    products: 250,
    districtAmount: 0,
    distanceAmount: 0,
    shipping: 0,
    total: 250,
  });
});
