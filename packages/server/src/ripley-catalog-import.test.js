import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ripleyListingDeactivationPlan,
  ripleyListingMetadata,
  selectRipleyProductCandidate,
} from './catalog/ripley-catalog-import.js';

function candidate(overrides = {}) {
  return {
    product: { id: 12, mainSku: 'AG12', name: 'Mochila de viaje negra' },
    profile: {
      name: 'Mochila de viaje negra',
      sellerSkus: ['MOC-12'],
      images: ['https://cdn.example/existing.jpg'],
      imageFingerprints: ['same-image'],
    },
    ...overrides,
  };
}

test('elige el producto existente cuando coinciden familia, SKU e imagen', () => {
  const result = selectRipleyProductCandidate({
    name: 'Mochila negra para viaje',
    sellerSku: 'MOC-12',
    images: ['https://cdn.example/ripley.jpg'],
    imageFingerprints: ['same-image'],
  }, [candidate()]);

  assert.equal(result?.product.mainSku, 'AG12');
  assert.equal(result?.confidence, 1);
  assert.ok(result?.signals.includes('image:content'));
  assert.ok(result?.signals.includes('seller_sku:exact'));
});

test('no autoasocia cuando dos productos tienen evidencia equivalente', () => {
  const result = selectRipleyProductCandidate({
    name: 'Mochila negra para viaje',
    images: ['https://cdn.example/ripley.jpg'],
    imageFingerprints: ['same-image'],
  }, [
    candidate(),
    candidate({ product: { id: 13, mainSku: 'AG13', name: 'Mochila viaje negra' } }),
  ]);

  assert.equal(result, null);
});

test('no autoasocia una familia débil aunque el precio sea parecido', () => {
  const result = selectRipleyProductCandidate({
    name: 'Escalera telescópica de aluminio',
    sellerSku: 'ESC-99',
    price: 99,
  }, [candidate()]);

  assert.equal(result, null);
});

test('prefiere la variante con talla explícita frente a un master sin talla', () => {
  const result = selectRipleyProductCandidate({
    name: 'Guantes tácticos mitones moto gym bicicleta talla L',
  }, [
    candidate({
      product: { id: 20, mainSku: 'AG20', name: 'Guantes tácticos mitones' },
      profile: { name: 'Guantes tácticos mitones moto gym bicicleta', images: [] },
    }),
    candidate({
      product: { id: 21, mainSku: 'AG21', name: 'Guantes tácticos talla L' },
      profile: { name: 'Guantes tácticos mitones moto gym bicicleta talla L', images: [] },
    }),
  ]);

  assert.equal(result?.product.mainSku, 'AG21');
  assert.ok(result?.signals.includes('size:L'));
});

test('una oferta activa conserva la señal de publicación del master', () => {
  const metadata = ripleyListingMetadata({
    imageUrl: 'https://cdn.example/product.jpg',
    price: 25,
  }, { batchId: 'batch-1', method: 'existing', confidence: 1, signals: [] });

  assert.equal(metadata.isPublished, true);
  assert.equal(metadata.marketplaceStatus, 'active');
});

test('refrescar una publicación conserva la evidencia de su asociación original', () => {
  const metadata = ripleyListingMetadata({ imageUrl: 'https://cdn.example/foto.jpg', price: 25 });
  assert.equal(metadata.isPublished, true);
  assert.equal(Object.hasOwn(metadata, 'associationMethod'), false);
  assert.equal(Object.hasOwn(metadata, 'catalogSyncBatchId'), false);
});

test('un sync completo desactiva ofertas ausentes o inactivas sin tocar sellers fallidos ni vínculos manualmente sueltos', () => {
  const plan = ripleyListingDeactivationPlan(
    [1],
    [{ company: { id: 1 }, offer: { sellerSku: 'ACTIVO' } }],
    [
      { id: 1, company_id: 1, seller_sku: 'ACTIVO', status: 'active' },
      { id: 2, company_id: 1, seller_sku: 'AUSENTE', status: 'active' },
      { id: 3, company_id: 1, seller_sku: 'SUELTO', status: 'unlinked' },
      { id: 4, company_id: 2, seller_sku: 'NO-CONSULTADO', status: 'active' },
    ],
  );

  assert.deepEqual(plan.map((listing) => listing.id), [2]);
});
