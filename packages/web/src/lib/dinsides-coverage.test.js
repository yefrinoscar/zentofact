import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DINSIDES_MIN_AMOUNT,
  DINSIDES_ZONE_LIST,
  dinsidesAmountInput,
  dinsidesZoneAt,
  dinsidesZoneByName,
  quoteDinsidesShipping,
  searchDinsidesZones,
} from './dinsides-coverage.ts';
import { METRO_POINTS } from './own-fleet-shipping.ts';

test('la cobertura de Dinsides trae sus 60 zonas de Lima y Callao, desde S/ 8', () => {
  assert.equal(DINSIDES_ZONE_LIST.length, 60);
  assert.equal(DINSIDES_MIN_AMOUNT, 8);
  assert.deepEqual(DINSIDES_ZONE_LIST[0], { name: 'Breña', amount: 8 });
});

test('el punto de entrega elige la zona aunque no sea un distrito oficial', () => {
  assert.deepEqual(dinsidesZoneAt(-12.121, -77.029), { name: 'Miraflores', amount: 10 });
  assert.deepEqual(dinsidesZoneAt(-12.017, -76.82), { name: 'Huaycán', amount: 12 });
  assert.equal(dinsidesZoneAt(-13.5, -71.9), null);
  assert.equal(dinsidesZoneAt(Number.NaN, -77), null);
});

test('el nombre del distrito resuelve tildes, mayúsculas y alias de la búsqueda', () => {
  assert.equal(dinsidesZoneByName('SAN MARTÍN DE PORRES')?.amount, 12);
  assert.equal(dinsidesZoneByName('Lurigancho')?.name, 'Lurigancho - Chosica');
  assert.equal(dinsidesZoneByName('Carmen De La Legua')?.name, 'Carmen de la Legua Reynoso');
  assert.equal(dinsidesZoneByName('Surco')?.name, 'Santiago de Surco');
  assert.equal(dinsidesZoneByName(''), null);
  assert.equal(dinsidesZoneByName('Arequipa'), null);
});

test('todos los distritos de Lima metropolitana que ofrece la búsqueda tienen tarifa', () => {
  for (const point of METRO_POINTS) {
    const quote = quoteDinsidesShipping(point);
    assert.equal(quote?.covered, true, point.district);
  }
});

test('si el punto cae fuera de los polígonos, cotiza por el nombre del distrito', () => {
  assert.deepEqual(
    quoteDinsidesShipping({ district: 'Pucusana', lat: -12.481, lng: -76.797 }),
    { covered: true, zone: 'Pucusana', amount: 28 },
  );
});

test('fuera de su cobertura no inventa precio', () => {
  assert.equal(quoteDinsidesShipping(null), null);
  assert.deepEqual(
    quoteDinsidesShipping({ district: 'Arequipa', lat: -16.409, lng: -71.537 }),
    { covered: false, district: 'Arequipa' },
  );
});

test('el monto para el campo de precio no arrastra decimales vacíos', () => {
  assert.equal(dinsidesAmountInput(10), '10');
  assert.equal(dinsidesAmountInput(14.5), '14.50');
});

test('la búsqueda de cobertura ignora tildes y entiende alias', () => {
  assert.deepEqual(searchDinsidesZones('rimac').map((zone) => zone.name), ['Rímac']);
  assert.deepEqual(searchDinsidesZones('SJL').map((zone) => zone.name), ['San Juan de Lurigancho']);
  assert.ok(searchDinsidesZones('ate').some((zone) => zone.name === 'Santa Clara - Ate'));
  assert.equal(searchDinsidesZones('  ').length, 60);
  assert.equal(searchDinsidesZones('arequipa').length, 0);
});
