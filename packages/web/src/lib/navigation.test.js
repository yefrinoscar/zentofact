import test from 'node:test';
import assert from 'node:assert/strict';
import { isNavItemActive, mobileNavPathname } from './nav-path.ts';

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
