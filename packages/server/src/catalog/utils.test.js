import test from 'node:test';
import assert from 'node:assert/strict';
import { mapProduct } from './utils.js';

test('mapProduct incluye el precio por mayor', () => {
  const product = mapProduct({
    id: 1,
    main_sku: 'AG301',
    name: 'Coche',
    status: 'active',
    attributes: {},
    unit: 'each',
    reference_price: 189.9,
    wholesale_price: 160,
    commission_amount: 20,
    quantity_on_hand: 12,
    quantity_reserved: 0,
  });
  assert.equal(product.wholesalePrice, 160);
  assert.equal(product.referencePrice, 189.9);
});

test('mapProduct deja el precio por mayor nulo si no hay valor', () => {
  const product = mapProduct({
    id: 2,
    main_sku: 'BB110',
    name: 'Almohada',
    status: 'active',
    attributes: {},
    unit: 'each',
    wholesale_price: null,
  });
  assert.equal(product.wholesalePrice, null);
});
