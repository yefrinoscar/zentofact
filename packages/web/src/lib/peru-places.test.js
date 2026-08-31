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
  assert.equal(quote?.priceZoneName, 'Media');
  assert.equal(quote?.districtAmount, 15);
  assert.equal(quote?.distanceAmount, 0);
  assert.equal(quote?.total, 15);

  const warehouse = quoteOwnFleetShipping(peruPlaceById('lima-san-miguel'));
  assert.equal(warehouse?.priceZoneName, 'Cerca');
  assert.equal(warehouse?.districtAmount, 10);
  assert.equal(warehouse?.distanceAmount, 0);
  assert.equal(warehouse?.total, 10);

  const arequipa = quoteOwnFleetShipping(peruPlaceById('dep-arequipa'));
  assert.equal(arequipa?.charged, false);
  assert.equal(arequipa?.zone.kind, 'out_of_range');
  assert.equal(arequipa?.total, 0);

  const ancon = quoteOwnFleetShipping(peruPlaceById('lima-ancon'));
  assert.equal(ancon?.charged, true);
  assert.equal(ancon?.zoneLabel, 'Ancón');
  assert.equal(ancon?.districtAmount, 25);
});

test('placeAtCoordinates asigna el distrito del punto, no un nombre buscado', () => {
  assert.equal(placeAtCoordinates(-12.114, -77.021).district, 'Surquillo');
  assert.equal(placeAtCoordinates(-12.0776, -77.0905).district, 'San Miguel');
  assert.equal(placeAtCoordinates(-12.135, -76.995).district, 'Santiago De Surco');
  assert.equal(placeAtCoordinates(-16.409, -71.537).department, 'Arequipa');
  assert.equal(placeAtCoordinates(-16.409, -71.537).reachable, false);
  assert.equal(placeAtCoordinates(-11.739, -77.15).district, 'Ancón');
  assert.equal(placeAtCoordinates(-11.739, -77.15).reachable, true);
  assert.equal(placeAtCoordinates(-11.495, -77.208).district, 'Huaral');
  assert.equal(placeAtCoordinates(-11.495, -77.208).reachable, false);
  assert.equal(placeAtCoordinates(-12.0776, -77.0905).reachable, true);
  assert.equal(placeAtCoordinates(-12.481, -76.797).district, 'Pucusana');
  assert.equal(placeAtCoordinates(-12.481, -76.797).reachable, false);
  assert.equal(placeAtCoordinates(-12.388, -76.778).district, 'San Bartolo');
  assert.equal(placeAtCoordinates(-12.388, -76.778).reachable, false);
  assert.equal(placeAtCoordinates(-12.274, -76.87).district, 'Lurín');
  assert.equal(placeAtCoordinates(-12.274, -76.87).reachable, true);
});
