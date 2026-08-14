import test from 'node:test';
import assert from 'node:assert/strict';
import { sellerPublicationRowBorderClass } from './seller-publication-row.ts';

test('sibling seller publications of the same product are not divided', () => {
  assert.equal(sellerPublicationRowBorderClass(false), 'border-b-0');
});

test('the last seller publication of a product keeps the group separator', () => {
  assert.equal(sellerPublicationRowBorderClass(true), 'border-b-4 border-b-muted');
});
