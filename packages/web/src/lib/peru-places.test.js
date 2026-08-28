import test from 'node:test';
import assert from 'node:assert/strict';
import { placeAtCoordinates, quoteOwnFleetShipping } from './own-fleet-shipping.ts';
import { peruPlaceById, searchPeruPlaces } from './peru-places.ts';

test('busca distritos de Lima y departamentos', () => {
  const surco = searchPeruPlaces('surco');
  assert.equal(surco[0]?.id, 'lima-surco');
  const arequipa = searchPeruPlaces('arequipa');
  assert.equal(arequipa[0]?.id, 'dep-arequipa');
  const sanMiguel = searchPeruPlaces('san miguel');
  assert.equal(sanMiguel[0]?.id, 'lima-san-miguel');
});

test('la búsqueda local alimenta la misma cotización de envío propio', () => {
  const surco = peruPlaceById('lima-surco');
  const quote = quoteOwnFleetShipping(surco);
  assert.equal(quote?.districtAmount, 16);
  assert.equal(quote?.distanceAmount, 20);
  assert.equal(quote?.total, 36);

  const warehouse = quoteOwnFleetShipping(peruPlaceById('lima-san-miguel'));
  assert.equal(warehouse?.districtAmount, 8);
  assert.equal(warehouse?.distanceAmount, 10);
  assert.equal(warehouse?.total, 18);

  const arequipa = quoteOwnFleetShipping(peruPlaceById('dep-arequipa'));
  assert.equal(arequipa?.districtAmount, 25);
  assert.equal(arequipa?.distanceAmount, 25);
  assert.equal(arequipa?.total, 50);
});

test('placeAtCoordinates asigna el distrito del punto, no un nombre buscado', () => {
  assert.equal(placeAtCoordinates(-12.114, -77.021).district, 'Surquillo');
  assert.equal(placeAtCoordinates(-12.0776, -77.0905).district, 'San Miguel');
  assert.equal(placeAtCoordinates(-12.135, -76.995).district, 'Santiago De Surco');
  assert.equal(placeAtCoordinates(-16.409, -71.537).department, 'Arequipa');
});
