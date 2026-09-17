import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveMercadoLibreCatalogMatch } from './mercadolibre-catalog-import.js';

test('asocia por listing existente o por main_sku y deja el resto sin mapear', () => {
  assert.deepEqual(resolveMercadoLibreCatalogMatch({
    sellerSku: 'HOG025',
    existingListing: { product_id: 8, main_sku: 'HOG025' },
    productsByMainSku: new Map(),
  }), { action: 'refresh', productId: 8, mainSku: 'HOG025' });
  assert.deepEqual(resolveMercadoLibreCatalogMatch({
    sellerSku: 'hog025',
    existingListing: null,
    productsByMainSku: new Map([['HOG025', { id: 3, mainSku: 'HOG025' }]]),
  }), { action: 'associate', productId: 3, mainSku: 'HOG025' });
  assert.deepEqual(resolveMercadoLibreCatalogMatch({
    sellerSku: 'OTRO',
    existingListing: null,
    productsByMainSku: new Map(),
  }), { action: 'unmapped' });
});
