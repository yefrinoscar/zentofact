import test from 'node:test';
import assert from 'node:assert/strict';
import { isNavItemActive, isNavItemVisible, mobileNavPathname } from './nav-path.ts';

test('mobileNavPathname deja Nueva venta bajo Mis ventas para vendedor', () => {
  const can = (key) => key === 'salesperson';
  assert.equal(mobileNavPathname('/orders/nueva', can), '/mis-ventas');
  assert.equal(mobileNavPathname('/orders/nueva/', can), '/mis-ventas');
  assert.equal(mobileNavPathname('/mis-ventas', can), '/mis-ventas');
});

test('mobileNavPathname no reescribe Nueva venta si también gestiona pedidos', () => {
  const can = (key) => key === 'salesperson' || key === 'order_management';
  assert.equal(mobileNavPathname('/orders/nueva', can), '/orders/nueva');
  assert.equal(isNavItemActive('/orders/nueva', '/orders'), true);
});

test('Envío propio no es un ítem de menú; vive en Ajustes', () => {
  const can = () => true;
  const settings = { to: '/settings', permission: 'settings' };
  assert.equal(isNavItemVisible(settings, can, false), true);
  assert.equal(isNavItemActive('/settings', '/settings'), true);
  assert.equal(isNavItemActive('/orders', '/orders'), true);
  assert.equal(isNavItemActive('/orders/envio', '/orders'), false);
  assert.equal(isNavItemActive('/envio-propio', '/orders'), false);
});
