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

test('Envío propio solo aparece para admin, dentro de Pedidos', () => {
  const item = { to: '/orders/envio', adminOnly: true };
  const can = () => true;
  assert.equal(isNavItemVisible(item, can, false, { isAdmin: true }), true);
  assert.equal(isNavItemVisible(item, can, false, { isAdmin: false }), false);
  assert.equal(isNavItemVisible(item, can, false, { isSuperadmin: true }), true);
  assert.equal(isNavItemVisible(item, can, false, {}), false);
  assert.equal(isNavItemActive('/orders/envio', '/orders'), false);
  assert.equal(isNavItemActive('/orders/envio', '/orders/envio'), true);
  assert.equal(isNavItemActive('/orders', '/orders'), true);
});
