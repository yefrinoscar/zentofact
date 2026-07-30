const assert = require('node:assert/strict');
const test = require('node:test');

const {
  areAllOrderItemsReadyToShip,
  groupReadyToShipPackages,
} = require('../dist/services/falabella-ready-to-ship.js');

test('agrupa cada etiqueta por PackageId con sus propios productos', () => {
  const packages = groupReadyToShipPackages([
    { OrderItemId: '56664583', PackageId: 'PKG-A', Status: 'pending' },
    { OrderItemId: '56664584', PackageId: 'PKG-B', Status: 'pending' },
    { OrderItemId: '56664585', PackageId: 'PKG-C', Status: 'pending' },
  ]);

  assert.deepEqual(packages, [
    { packageId: 'PKG-A', orderItemIds: ['56664583'] },
    { packageId: 'PKG-B', orderItemIds: ['56664584'] },
    { packageId: 'PKG-C', orderItemIds: ['56664585'] },
  ]);
});

test('conserva juntos los productos que pertenecen a la misma etiqueta', () => {
  const packages = groupReadyToShipPackages([
    { OrderItemId: '10', PackageId: 'PKG-A' },
    { OrderItemId: '11', PackageId: 'PKG-A' },
    { OrderItemId: '12', PackageId: 'PKG-B' },
  ]);

  assert.deepEqual(packages, [
    { packageId: 'PKG-A', orderItemIds: ['10', '11'] },
    { packageId: 'PKG-B', orderItemIds: ['12'] },
  ]);
});

test('detecta cuando Falabella ya dejó toda la orden lista', () => {
  assert.equal(areAllOrderItemsReadyToShip([
    { Status: 'ready_to_ship' },
    { status: 'ready_to_ship' },
  ]), true);
  assert.equal(areAllOrderItemsReadyToShip([
    { Status: 'ready_to_ship' },
    { Status: 'pending' },
  ]), false);
});
