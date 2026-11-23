import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOGO_VENDEDOR_PAGE_SIZE,
  DEFAULT_CATALOGO_VENDEDOR_STATE,
  catalogoVendedorKey,
  commissionDisplay,
  formatProductMoney,
  productCountLabel,
  salespersonProductsFilter,
  sortingToQuery,
  stockDisplay,
} from './catalogo-vendedor.ts';

test('el filtro omite búsqueda vacía y stock "Todos", y pagina de 20 en 20', () => {
  assert.deepEqual(salespersonProductsFilter(DEFAULT_CATALOGO_VENDEDOR_STATE), {
    sortBy: 'name',
    sortDir: 'asc',
    limit: CATALOGO_VENDEDOR_PAGE_SIZE,
    offset: 0,
  });
  assert.equal(CATALOGO_VENDEDOR_PAGE_SIZE, 20);
});

test('el filtro recorta la búsqueda, envía stock y calcula el offset', () => {
  assert.deepEqual(salespersonProductsFilter({
    search: '  polo  ',
    stock: 'outOfStock',
    sortBy: 'commission',
    sortDir: 'desc',
    pageIndex: 2,
  }), {
    search: 'polo',
    stock: 'outOfStock',
    sortBy: 'commission',
    sortDir: 'desc',
    limit: 20,
    offset: 40,
  });
  assert.equal(salespersonProductsFilter({ ...DEFAULT_CATALOGO_VENDEDOR_STATE, search: '   ' }).search, undefined);
  assert.equal(salespersonProductsFilter({ ...DEFAULT_CATALOGO_VENDEDOR_STATE, pageIndex: -3 }).offset, 0);
});

test('la clave de caché cambia con el filtro', () => {
  const a = catalogoVendedorKey(salespersonProductsFilter(DEFAULT_CATALOGO_VENDEDOR_STATE));
  const b = catalogoVendedorKey(salespersonProductsFilter({ ...DEFAULT_CATALOGO_VENDEDOR_STATE, pageIndex: 1 }));
  assert.equal(a[0], b[0]);
  assert.notDeepEqual(a, b);
});

test('el orden de React Table se traduce a sortBy/sortDir y cae a nombre ascendente', () => {
  assert.deepEqual(sortingToQuery([{ id: 'commission', desc: true }]), { sortBy: 'commission', sortDir: 'desc' });
  assert.deepEqual(sortingToQuery([{ id: 'stock', desc: false }]), { sortBy: 'stock', sortDir: 'asc' });
  assert.deepEqual(sortingToQuery([]), { sortBy: 'name', sortDir: 'asc' });
  assert.deepEqual(sortingToQuery([{ id: 'product', desc: true }]), { sortBy: 'name', sortDir: 'asc' });
});

test('la comisión fija del producto se muestra sin porcentaje', () => {
  const display = commissionDisplay({ commissionAmount: 5, commissionRule: 'catalog' }, 10);
  assert.equal(display.amount, formatProductMoney(5));
  assert.equal(display.hint, null);
  assert.equal(display.empty, false);
});

test('la comisión por porcentaje muestra el monto y el % del vendedor', () => {
  const display = commissionDisplay({ commissionAmount: 4.5, commissionRule: 'percent' }, 7.5);
  assert.equal(display.amount, formatProductMoney(4.5));
  assert.equal(display.hint, '7.5%');
  assert.equal(commissionDisplay({ commissionAmount: 3, commissionRule: 'percent' }, 10).hint, '10%');
  assert.equal(commissionDisplay({ commissionAmount: 0, commissionRule: 'percent' }, 0).hint, null);
});

test('sin comisión configurada se muestra un guion con explicación', () => {
  assert.deepEqual(commissionDisplay({ commissionAmount: null, commissionRule: 'none' }, 10), {
    amount: '—',
    hint: null,
    title: 'Sin comisión configurada',
    empty: true,
  });
  assert.equal(commissionDisplay({ commissionAmount: null, commissionRule: 'catalog' }, 10).empty, true);
});

test('el stock en cero o negativo es "Sin stock"', () => {
  assert.deepEqual(stockDisplay(0), { label: 'Sin stock', out: true, tone: 'out', value: 0 });
  assert.deepEqual(stockDisplay(-2), { label: 'Sin stock', out: true, tone: 'out', value: 0 });
  assert.deepEqual(stockDisplay(1), { label: '1 unidad', out: false, tone: 'low', value: 1 });
  assert.deepEqual(stockDisplay(5), { label: '5 unidades', out: false, tone: 'low', value: 5 });
  assert.deepEqual(stockDisplay(12), { label: '12 unidades', out: false, tone: 'ok', value: 12 });
});

test('el conteo describe filtro y búsqueda activos', () => {
  assert.equal(productCountLabel(1, 'all', ''), '1 producto');
  assert.equal(productCountLabel(34, 'inStock', ''), '34 productos con stock');
  assert.equal(productCountLabel(0, 'outOfStock', ' polo '), '0 productos sin stock para “polo”');
});
