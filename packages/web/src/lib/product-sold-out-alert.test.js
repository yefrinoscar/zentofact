import test from 'node:test';
import assert from 'node:assert/strict';
import { freshProductSoldOutIds, unreadProductSoldOutIds } from './product-sold-out-alert.ts';

const soldOut = {
  id: 'product_sold_out:22:18',
  kind: 'product_sold_out',
  unread: true,
};
const overdue = {
  id: 'bandeja_overdue:3',
  kind: 'bandeja_overdue',
  unread: true,
};

test('solo cuenta productos agotados sin leer', () => {
  assert.deepEqual(
    unreadProductSoldOutIds([
      soldOut,
      overdue,
      { ...soldOut, id: 'product_sold_out:9:2', unread: false },
    ]),
    ['product_sold_out:22:18'],
  );
});

test('el sonido suena solo cuando aparece un aviso nuevo', () => {
  assert.deepEqual(
    freshProductSoldOutIds(['product_sold_out:22:18'], ['product_sold_out:22:18', 'product_sold_out:9:12']),
    ['product_sold_out:9:12'],
  );
  assert.deepEqual(freshProductSoldOutIds([], ['product_sold_out:22:18']), ['product_sold_out:22:18']);
  assert.deepEqual(freshProductSoldOutIds(['product_sold_out:22:18'], ['product_sold_out:22:18']), []);
});
