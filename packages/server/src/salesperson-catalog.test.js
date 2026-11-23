import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listSalespersonCatalog,
  mapSalespersonCatalogRow,
  parseSalespersonCatalogFilters,
  salespersonCatalogQuery,
  salespersonProductPrice,
  unitCommission,
} from './salesperson-catalog.js';

function compact(sql) {
  return String(sql || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function productRow(overrides = {}) {
  return {
    id: '7', main_sku: 'AG301', name: 'Manta', brand: 'Zentoo', image_url: 'https://media.falabella.com/x_01',
    commission_amount: null, reference_price: '100', seller_price_min: '90', available: '4',
    wholesale_price: '50', profit_owner: 'Ana', cost: '20', total_count: '1',
    ...overrides,
  };
}

test('los filtros por defecto ordenan por nombre ascendente en páginas de 25', () => {
  assert.deepEqual(parseSalespersonCatalogFilters({}), {
    search: '', stock: 'all', sortBy: 'name', sortDir: 'asc', limit: 25, offset: 0,
  });
  const parsed = parseSalespersonCatalogFilters({
    search: '  manta ', stock: 'inStock', sortBy: 'commission', sortDir: 'DESC', limit: '500', offset: '50',
  });
  assert.deepEqual(parsed, {
    search: 'manta', stock: 'inStock', sortBy: 'commission', sortDir: 'desc', limit: 100, offset: 50,
  });
});

test('los filtros rechazan valores fuera de la lista permitida', () => {
  assert.throws(() => parseSalespersonCatalogFilters({ sortBy: 'wholesale_price' }), /sortBy inválido/);
  assert.throws(() => parseSalespersonCatalogFilters({ sortBy: 'name; drop table products' }), /sortBy inválido/);
  assert.throws(() => parseSalespersonCatalogFilters({ sortDir: 'sideways' }), /sortDir inválido/);
  assert.throws(() => parseSalespersonCatalogFilters({ stock: 'lowStock' }), /stock inválido/);
  assert.throws(() => parseSalespersonCatalogFilters({ limit: '0' }), /limit inválido/);
  assert.throws(() => parseSalespersonCatalogFilters({ limit: '2.5' }), /limit inválido/);
  assert.throws(() => parseSalespersonCatalogFilters({ offset: '-1' }), /offset inválido/);
  assert.throws(() => parseSalespersonCatalogFilters({ search: 'x'.repeat(121) }), /search/);
  try {
    parseSalespersonCatalogFilters({ sortBy: 'nope' });
  } catch (error) {
    assert.equal(error.status, 400);
  }
});

test('el precio sigue la regla de Nueva venta', () => {
  assert.equal(salespersonProductPrice('100', '90'), 100);
  assert.equal(salespersonProductPrice('0', '90'), 90);
  assert.equal(salespersonProductPrice(null, '90.5'), 90.5);
  assert.equal(salespersonProductPrice(null, null), 0);
  assert.equal(salespersonProductPrice('-5', '0'), 0);
});

test('la comisión fija del Producto manda sobre el % del vendedor', () => {
  assert.deepEqual(unitCommission('12.5', 100, 10), { commissionAmount: 12.5, commissionRule: 'catalog' });
  assert.deepEqual(unitCommission('0', 100, 10), { commissionAmount: 0, commissionRule: 'catalog' });
  assert.deepEqual(unitCommission(null, 99.99, 7.5), { commissionAmount: 7.5, commissionRule: 'percent' });
  assert.deepEqual(unitCommission(null, 0, 10), { commissionAmount: 0, commissionRule: 'percent' });
  assert.deepEqual(unitCommission(null, 100, 0), { commissionAmount: null, commissionRule: 'none' });
  assert.deepEqual(unitCommission(undefined, 100, null), { commissionAmount: null, commissionRule: 'none' });
});

test('la fila solo expone campos seguros para el vendedor', () => {
  const item = mapSalespersonCatalogRow(productRow(), 10);
  assert.deepEqual(item, {
    id: 7, sku: 'AG301', name: 'Manta', brand: 'Zentoo', imageUrl: 'https://media.falabella.com/x_01',
    price: 100, available: 4, commissionAmount: 10, commissionRule: 'percent',
  });
  const fallback = mapSalespersonCatalogRow(productRow({
    reference_price: null, brand: '', image_url: '', commission_amount: '3', available: '-2',
  }), 10);
  assert.equal(fallback.price, 90);
  assert.equal(fallback.brand, null);
  assert.equal(fallback.imageUrl, null);
  assert.equal(fallback.available, -2);
  assert.equal(fallback.commissionRule, 'catalog');
  assert.equal(fallback.commissionAmount, 3);
});

test('la consulta solo trae productos activos y parametriza la búsqueda', () => {
  const filters = parseSalespersonCatalogFilters({ search: "a'b", stock: 'outOfStock', sortBy: 'price', sortDir: 'desc' });
  const { sql, values } = salespersonCatalogQuery(filters, 5);
  const text = compact(sql);
  assert.match(text, /p\.status='active'/);
  assert.match(text, /p\.main_sku ilike \$2 or p\.name ilike \$2/);
  assert.match(text, /\(i\.quantity_on_hand - i\.quantity_reserved - coalesce\(i\.quantity_pending_return, 0\)\) <= 0/);
  assert.match(text, /order by base\.price desc nulls last, base\.id desc limit \$3 offset \$4/);
  assert.doesNotMatch(text, /a'b/);
  assert.deepEqual(values, [5, "%a'b%", 25, 0]);
  assert.doesNotMatch(text, /wholesale_price|profit_owner/);
});

test('el listado devuelve página, total y % del vendedor', async () => {
  const calls = [];
  const db = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [productRow(), productRow({ id: '8', name: 'Bolso', commission_amount: '4', total_count: '2' })] };
    },
  };
  const result = await listSalespersonCatalog({ limit: '2' }, { commissionPercent: '5' }, db);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].values, [5, 2, 0]);
  assert.equal(result.total, 1);
  assert.equal(result.limit, 2);
  assert.equal(result.offset, 0);
  assert.equal(result.commissionPercent, 5);
  assert.deepEqual(result.items.map((item) => [item.id, item.commissionRule, item.commissionAmount]), [
    [7, 'percent', 5],
    [8, 'catalog', 4],
  ]);
  for (const item of result.items) {
    assert.deepEqual(Object.keys(item).sort(), [
      'available', 'brand', 'commissionAmount', 'commissionRule', 'id', 'imageUrl', 'name', 'price', 'sku',
    ]);
  }
  const empty = await listSalespersonCatalog({}, {}, { async query() { return { rows: [] }; } });
  assert.deepEqual(empty, { items: [], total: 0, limit: 25, offset: 0, commissionPercent: 0 });
});
