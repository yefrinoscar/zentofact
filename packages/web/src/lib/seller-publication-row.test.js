import test from 'node:test';
import assert from 'node:assert/strict';
import { sellerPublicationRowBorderClass } from './seller-publication-row.ts';

test('sibling seller publications use a subtle row divider', () => {
  assert.equal(sellerPublicationRowBorderClass(false), 'border-b border-b-border/60');
});

test('the last seller publication of a product keeps the group separator', () => {
  assert.equal(sellerPublicationRowBorderClass(true), 'border-b-4 border-b-muted');
});
