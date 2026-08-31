import test from 'node:test';
import assert from 'node:assert/strict';
import { OWN_FLEET_ORIGIN } from './own-fleet-shipping.ts';
import {
  formatPickupHour,
  pickupHours,
  pickupMapsUrl,
  pickupMessage,
  pickupPoint,
} from './pickup-message.ts';

const almacen = {
  address: 'C. las Almendras Mz.Z1 - Lt.5',
  lat: -12.154351,
  lng: -76.97931,
  pickupFrom: '07:00',
  pickupTo: '17:00',
};

test('el horario se lee como lo escribiría el vendedor', () => {
  assert.equal(formatPickupHour('07:00'), '7:00 a. m.');
  assert.equal(formatPickupHour('17:00'), '5:00 p. m.');
  assert.equal(formatPickupHour('00:30'), '12:30 a. m.');
  assert.equal(formatPickupHour('12:00'), '12:00 p. m.');
  assert.equal(formatPickupHour('13:45'), '1:45 p. m.');
  assert.equal(formatPickupHour(''), '');
  assert.equal(pickupHours(almacen), '7:00 a. m. a 5:00 p. m.');
});

test('el enlace de mapa apunta al pin exacto del almacén', () => {
  assert.equal(
    pickupMapsUrl(almacen),
    'https://www.google.com/maps/search/?api=1&query=-12.154351,-76.97931',
  );
});

test('el mensaje de recojo trae dirección, horario y mapa, listo para pegar', () => {
  assert.equal(pickupMessage(almacen), [
    'Recoge aquí: C. las Almendras Mz.Z1 - Lt.5',
    'Horario: 7:00 a. m. a 5:00 p. m.',
    'https://www.google.com/maps/search/?api=1&query=-12.154351,-76.97931',
  ].join('\n'));
});

test('el mensaje usa el almacén configurado por el admin', () => {
  const message = pickupMessage({
    address: 'Av. Nueva 123',
    lat: -12.1,
    lng: -77,
    pickupFrom: '09:30',
    pickupTo: '18:00',
  });
  assert.match(message, /Recoge aquí: Av\. Nueva 123/);
  assert.match(message, /Horario: 9:30 a\. m\. a 6:00 p\. m\./);
  assert.match(message, /query=-12\.1,-77/);
});

test('sin configuración cae al almacén por defecto', () => {
  const point = pickupPoint(null);
  assert.equal(point.address, OWN_FLEET_ORIGIN.address);
  assert.equal(point.lat, OWN_FLEET_ORIGIN.lat);
  assert.equal(point.pickupFrom, OWN_FLEET_ORIGIN.pickupFrom);
  assert.equal(point.pickupTo, OWN_FLEET_ORIGIN.pickupTo);
});
