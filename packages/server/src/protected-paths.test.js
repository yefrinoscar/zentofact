import test from 'node:test';
import assert from 'node:assert/strict';
import { isProtectedPath } from './protected-paths.js';

test('la bandeja de pedidos exige sesión para lectura y sincronización', () => {
  assert.equal(isProtectedPath('/orders-inbox'), true);
  assert.equal(isProtectedPath('/orders-inbox/sync'), true);
  assert.equal(isProtectedPath('/order-management/orders'), true);
  assert.equal(isProtectedPath('/order-management/accounts'), true);
});

test('insumos exige sesión para lectura y ajustes', () => {
  assert.equal(isProtectedPath('/insumos'), true);
  assert.equal(isProtectedPath('/insumos/3/adjust'), true);
});

test('el catálogo y el inventario cargan la sesión antes de validar permisos', () => {
  assert.equal(isProtectedPath('/products'), true);
  assert.equal(isProtectedPath('/products/42/inventory'), true);
  assert.equal(isProtectedPath('/product-listings/7'), true);
  assert.equal(isProtectedPath('/inventory/resolve-sku'), true);
  assert.equal(isProtectedPath('/catalog/import/falabella'), true);
  assert.equal(isProtectedPath('/catalog/unmapped-skus'), true);
});

test('Ripley carga la sesión antes de validar el permiso de pedidos', () => {
  assert.equal(isProtectedPath('/ripley/1/orders'), true);
});

test('no protege rutas públicas con prefijos parecidos', () => {
  assert.equal(isProtectedPath('/orders-inbox-public'), false);
  assert.equal(isProtectedPath('/health'), false);
  assert.equal(isProtectedPath('/products-public'), false);
});
