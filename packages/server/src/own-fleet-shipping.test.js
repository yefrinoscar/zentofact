import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OWN_FLEET_ORIGIN,
  applyOwnFleetShipping,
  quoteOwnFleetShipping,
} from './own-fleet-shipping.js';

test('applyOwnFleetShipping cobra el precio de la zona, sin recargo por distancia', () => {
  const quoted = applyOwnFleetShipping({
    subtotal: 250,
    total: 250,
    shippingAmount: null,
    shipping: {
      type: 'envio',
      carrier: 'nosotros',
      district: 'San Miguel',
      province: 'Lima',
      department: 'Lima',
      lat: OWN_FLEET_ORIGIN.lat,
      lng: OWN_FLEET_ORIGIN.lng,
    },
  });
  assert.equal(quoted.shipping.priceZone, 'Cerca');
  assert.equal(quoted.shipping.districtAmount, 10);
  assert.equal(quoted.shipping.distanceAmount, 0);
  assert.equal(quoted.shippingAmount, 10);
  assert.equal(quoted.total, 260);
});

test('applyOwnFleetShipping no altera un repartidor tercero', () => {
  const order = {
    subtotal: 250,
    total: 250,
    shippingAmount: null,
    shipping: { type: 'envio', carrier: 'shaloom' },
  };
  assert.equal(applyOwnFleetShipping(order), order);
});

test('el pin en Surquillo cobra Surquillo aunque el payload diga San Miguel', () => {
  const quoted = applyOwnFleetShipping({
    subtotal: 189.9,
    total: 189.9,
    shippingAmount: null,
    shipping: {
      type: 'envio',
      carrier: 'nosotros',
      district: 'San Miguel',
      province: 'Lima',
      department: 'Lima',
      lat: -12.114,
      lng: -77.021,
    },
  });
  assert.equal(quoted.shipping.district, 'Surquillo');
  assert.equal(quoted.shipping.zoneLabel, 'Surquillo');
  assert.equal(quoted.shipping.priceZone, 'Cerca');
  assert.equal(quoted.shipping.districtAmount, 10);
});

test('Huaral y provincias no tienen movilidad propia; Ancón sí porque es Lima metropolitana', () => {
  const quote = quoteOwnFleetShipping({
    district: 'Cercado',
    province: 'Arequipa',
    department: 'Arequipa',
    lat: -16.409,
    lng: -71.537,
  });
  assert.equal(quote.charged, false);
  assert.equal(quote.zone.kind, 'out_of_range');
  assert.equal(quote.total, 0);
  assert.ok(quote.distanceKm > 25);

  const ancon = applyOwnFleetShipping({
    subtotal: 250,
    total: 250,
    shipping: {
      type: 'envio',
      carrier: 'nosotros',
      lat: -11.739,
      lng: -77.15,
    },
  });
  assert.equal(ancon.shipping.district, 'Ancón');
  assert.equal(ancon.shipping.priceZone, 'Lejos');
  assert.equal(ancon.shipping.districtAmount, 25);
  assert.equal(ancon.shippingAmount, 25);

  assert.throws(
    () => applyOwnFleetShipping({
      subtotal: 250,
      total: 250,
      shipping: {
        type: 'envio',
        carrier: 'nosotros',
        lat: -11.495,
        lng: -77.208,
      },
    }),
    /Express no llega ahí/,
  );
});

test('applyOwnFleetShipping rechaza un pin fuera del Perú', () => {
  assert.throws(
    () => applyOwnFleetShipping({
      subtotal: 250,
      total: 250,
      shipping: {
        type: 'envio',
        carrier: 'nosotros',
        lat: 40.4168,
        lng: -3.7038,
      },
    }),
    /Esa dirección no está en el Perú/,
  );
});

test('Pucusana y San Bartolo no se cobran hasta que el admin las encienda', () => {
  assert.throws(
    () => applyOwnFleetShipping({
      subtotal: 250,
      total: 250,
      shipping: {
        type: 'envio',
        carrier: 'nosotros',
        lat: -12.481,
        lng: -76.797,
      },
    }),
    /Express no llega ahí/,
  );
  assert.throws(
    () => applyOwnFleetShipping({
      subtotal: 250,
      total: 250,
      shipping: {
        type: 'envio',
        carrier: 'nosotros',
        lat: -12.388,
        lng: -76.778,
      },
    }),
    /Express no llega ahí/,
  );

  const quoted = applyOwnFleetShipping({
    subtotal: 250,
    total: 250,
    shipping: {
      type: 'envio',
      carrier: 'nosotros',
      lat: -12.481,
      lng: -76.797,
    },
  }, {
    zones: [{ key: 'lejos', name: 'Lejos', amount: 30 }],
    districts: [{ key: 'pucusana', zone: 'lejos', enabled: true }],
  });
  assert.equal(quoted.shipping.district, 'Pucusana');
  assert.equal(quoted.shipping.districtAmount, 30);
  // A más de 40 km del almacén y aun así paga solo su zona.
  assert.equal(quoted.shippingAmount, 30);
  assert.ok(quoted.shipping.distanceKm > 40);
});
