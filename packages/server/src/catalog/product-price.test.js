import test from 'node:test';
import assert from 'node:assert/strict';
import { createProduct, updateProduct } from './product-service.js';

test('createProduct rechaza un precio por mayor negativo', async () => {
  await assert.rejects(
    () => createProduct({
      mainSku: 'AG9',
      name: 'Prueba',
      wholesalePrice: -5,
    }, '1', { query: async () => ({ rows: [] }) }),
    (error) => error.message.includes('wholesalePrice no puede ser negativo'),
  );
});

test('updateProduct rechaza un precio por mayor negativo', async () => {
  await assert.rejects(
    () => updateProduct(1, { wholesalePrice: -1 }, '1', { query: async () => ({ rows: [] }) }),
    (error) => error.message.includes('wholesalePrice no puede ser negativo'),
  );
});
