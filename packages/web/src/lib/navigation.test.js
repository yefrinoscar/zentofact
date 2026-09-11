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

test('Ventas usa el permiso de dashboard', () => {
  const ventas = { to: '/ventas', permission: 'dashboard' };
  assert.equal(isNavItemVisible(ventas, (key) => key === 'dashboard', false), true);
  assert.equal(isNavItemVisible(ventas, () => false, false), false);
});

test('Bandeja Falabella no aparece en producción', () => {
  const can = () => true;
  const item = { to: '/pedidos', permission: 'orders_inbox', hiddenInProduction: true };
  assert.equal(isNavItemVisible(item, can, true), false);
  assert.equal(isNavItemVisible(item, can, false), true);
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
