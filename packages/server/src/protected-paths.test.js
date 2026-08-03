import test from 'node:test';
import assert from 'node:assert/strict';
import { isProtectedPath } from './protected-paths.js';

test('la bandeja de pedidos exige sesión para lectura y sincronización', () => {
  assert.equal(isProtectedPath('/orders-inbox'), true);
  assert.equal(isProtectedPath('/orders-inbox/sync'), true);
  assert.equal(isProtectedPath('/order-management/orders'), true);
  assert.equal(isProtectedPath('/order-management/accounts'), true);
});

test('no protege rutas públicas con prefijos parecidos', () => {
  assert.equal(isProtectedPath('/orders-inbox-public'), false);
  assert.equal(isProtectedPath('/health'), false);
});
