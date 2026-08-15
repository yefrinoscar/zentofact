import test from 'node:test';
import assert from 'node:assert/strict';
import { sellerShortName } from './seller-name.ts';

test('seller names use the short commercial name in sentence case', () => {
  assert.equal(sellerShortName('LIMBO'), 'Limbo');
  assert.equal(sellerShortName('MANTA RAYA'), 'Manta raya');
  assert.equal(sellerShortName('INVERSIONES YAKURUNA S.A.C.'), 'Yakuruna');
  assert.equal(sellerShortName('TIENDAS RUNAPUMA PERÚ'), 'Runapuma');
});

test('seller names keep a useful fallback', () => {
  assert.equal(sellerShortName(''), 'Seller');
  assert.equal(sellerShortName(null), 'Seller');
});
