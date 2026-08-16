const assert = require('node:assert/strict');
const test = require('node:test');

const {
  areAllOrderItemsReadyToShip,
  canPrintFalabellaShippingLabel,
  groupReadyToShipPackages,
  pendingReadyToShipOrderItems,
  readyToShipReachedStatus,
} = require('../dist/services/falabella-ready-to-ship.js');

test('permite imprimir etiquetas pendientes o listas para enviar', () => {
  assert.equal(canPrintFalabellaShippingLabel('pending'), true);
  assert.equal(canPrintFalabellaShippingLabel('ready_to_ship'), true);
  assert.equal(canPrintFalabellaShippingLabel('pending|ready_to_ship'), true);
});

test('impide imprimir etiquetas de pedidos terminales o sin estado', () => {
  assert.equal(canPrintFalabellaShippingLabel('shipped'), false);
  assert.equal(canPrintFalabellaShippingLabel('delivered'), false);
  assert.equal(canPrintFalabellaShippingLabel('canceled'), false);
  assert.equal(canPrintFalabellaShippingLabel('ready_to_ship|shipped'), false);
  assert.equal(canPrintFalabellaShippingLabel(''), false);
});

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
    { Status: 'shipped' },
  ]), true);
  assert.equal(readyToShipReachedStatus([
    { Status: 'shipped' },
    { Status: 'delivered' },
  ]), 'shipped');
  assert.equal(readyToShipReachedStatus([
    { Status: 'delivered' },
    { Status: 'delivered' },
  ]), 'delivered');
  assert.equal(areAllOrderItemsReadyToShip([
    { Status: 'ready_to_ship' },
    { Status: 'pending' },
  ]), false);
});

test('un reintento omite los paquetes que Falabella ya dejó listos', () => {
  const pendingItems = pendingReadyToShipOrderItems([
    { OrderItemId: '10', PackageId: 'PKG-A', Status: 'ready_to_ship' },
    { OrderItemId: '13', PackageId: 'PKG-A', Status: 'shipped' },
    { OrderItemId: '14', PackageId: 'PKG-A', Status: 'delivered' },
    { OrderItemId: '11', PackageId: 'PKG-B', Status: 'pending' },
    { OrderItemId: '12', PackageId: 'PKG-B', Status: 'pending' },
  ]);

  assert.deepEqual(groupReadyToShipPackages(pendingItems), [
    { packageId: 'PKG-B', orderItemIds: ['11', '12'] },
  ]);
});
