import test from 'node:test';
import assert from 'node:assert/strict';
import { detectOrderItemVariant, looseVariant, sizeFromTitle } from './order-item-variant.js';

test('lee la talla del atributo Variation de Falabella', () => {
  assert.deepEqual(
    detectOrderItemVariant({ raw: { Sku: 'CAMISBLAA2', Name: 'Camiseta Faja Vivid Bvd', Variation: 'M' } }),
    { color: '', size: 'M', label: 'Talla M', source: 'order' },
  );
  assert.equal(detectOrderItemVariant({ raw: [{ Variation: '...' }, { Variation: 'Talla XL' }] }).size, 'XL');
  assert.deepEqual(
    detectOrderItemVariant({ raw: { Variation: 'Negro / L' } }),
    { color: 'Negro', size: 'L', label: 'Negro · Talla L', source: 'order' },
  );
});

test('lee atributos estructurados y JSON serializado', () => {
  assert.equal(detectOrderItemVariant({ raw: { Variation: '{"Talla":"S","Color":"Blanco"}' } }).size, 'S');
  assert.equal(detectOrderItemVariant({
    raw: { Attributes: [{ AttributeName: 'Size', Value: '2XL' }] },
  }).size, '2XL');
  const ml = detectOrderItemVariant({
    raw: { item: { variation_attributes: [
      { id: 'COLOR', name: 'Color', value_name: 'Negro' },
      { id: 'SIZE', name: 'Talla', value_name: 'M' },
    ] } },
  });
  assert.equal(ml.size, 'M');
  assert.equal(ml.color, 'Negro');
});

test('ignora cantidad de pack y usa caché, listing y título como respaldo', () => {
  assert.deepEqual(
    detectOrderItemVariant({ raw: { Variation: '...', Size: '1' }, cached: { size: 'l', color: 'Negro' } }),
    { color: 'Negro', size: 'L', label: 'Negro · Talla L', source: 'variant_cache' },
  );
  assert.equal(detectOrderItemVariant({ listingMetadata: { size: 'XS' } }).source, 'listing');
  assert.equal(detectOrderItemVariant({ title: 'Camiseta Faja Talla M Negro' }).size, 'M');
  assert.deepEqual(detectOrderItemVariant({ title: 'Camiseta Faja Reductora Vivid Bvd' }),
    { color: '', size: '', label: '', source: '' });
});

test('no confunde palabras del título con tallas', () => {
  assert.equal(sizeFromTitle('Botella Acero 500ml L'), '');
  assert.equal(sizeFromTitle('Polo Algodón - Blanco M'), 'M');
  assert.deepEqual(looseVariant('Vivid'), { color: '', size: '' });
});
