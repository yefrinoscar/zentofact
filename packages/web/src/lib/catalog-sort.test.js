import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogColumnSortAria, catalogColumnSortState, nextCatalogColumnSort } from './catalog-sort.ts';

test('el primer clic ordena la columna de mayor a menor', () => {
  assert.equal(nextCatalogColumnSort('updated_desc', 'stock'), 'inventory_desc');
  assert.equal(nextCatalogColumnSort('updated_desc', 'price'), 'price_desc');
  assert.equal(nextCatalogColumnSort('updated_desc', 'pace'), 'pace_desc');
});

test('el segundo clic invierte la misma columna', () => {
  assert.equal(nextCatalogColumnSort('inventory_desc', 'stock'), 'inventory_asc');
  assert.equal(nextCatalogColumnSort('inventory_asc', 'stock'), 'inventory_desc');
  assert.equal(nextCatalogColumnSort('pace_desc', 'price'), 'price_desc');
});

test('el estado activo solo aplica a la columna ordenada', () => {
  assert.deepEqual(catalogColumnSortState('pace_desc'), { column: 'pace', dir: 'desc' });
  assert.equal(catalogColumnSortState('updated_desc'), null);
});

test('el aria describe el orden actual y el siguiente clic', () => {
  assert.match(catalogColumnSortAria('stock', 'updated_desc'), /Ordenar por Stock/);
  assert.match(catalogColumnSortAria('stock', 'inventory_desc'), /más unidades primero/);
  assert.match(catalogColumnSortAria('stock', 'inventory_desc'), /menos unidades primero/);
});
