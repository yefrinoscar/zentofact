import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOGO_VENDEDOR_PAGE_SIZE,
  DEFAULT_CATALOGO_VENDEDOR_STATE,
  catalogoVendedorKey,
  commissionDisplay,
  formatProductMoney,
  productCountLabel,
  productGalleryUrls,
  productPublicationText,
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

test('oculta marcas de relleno como GENERICO y conserva marcas reales', async () => {
  const { visibleBrand } = await import('./catalogo-vendedor.ts');
  assert.equal(visibleBrand('GENERICO'), null);
  assert.equal(visibleBrand(' Genérico '), null);
  assert.equal(visibleBrand('sin marca'), null);
  assert.equal(visibleBrand(null), null);
  assert.equal(visibleBrand('Xiaomi'), 'Xiaomi');
});

test('la galería de Falabella lista {sku}_01…_08 a partir de cualquier foto', () => {
  const urls = productGalleryUrls('https://media.falabella.com/falabellaPE/PMP20000722586-1_01');
  assert.equal(urls.length, 8);
  assert.equal(urls[0], 'https://media.falabella.com/falabellaPE/PMP20000722586-1_01');
  assert.equal(urls[7], 'https://media.falabella.com/falabellaPE/PMP20000722586-1_08');
  assert.equal(productGalleryUrls('https://media.falabella.com/falabellaPE/118765881_3?wid=800')[1], 'https://media.falabella.com/falabellaPE/118765881_02');
});

test('una foto que no es de Falabella se usa tal cual y sin foto no hay galería', () => {
  assert.deepEqual(productGalleryUrls('/seed/ag301.svg'), ['/seed/ag301.svg']);
  assert.deepEqual(productGalleryUrls(null), []);
  assert.deepEqual(productGalleryUrls('  '), []);
});

test('el texto para publicar lleva nombre, marca visible y precio', () => {
  const text = productPublicationText({ name: ' Silla de comer ', brand: 'Zento', price: 249, available: 8 });
  const lines = text.split('\n');
  assert.equal(lines[0], 'Silla de comer');
  assert.equal(lines[1], 'Marca: Zento');
  assert.match(lines[2], /^Precio: S\/\s?249\.00$/);
  assert.equal(lines.length, 4);
  assert.equal(lines[3], 'Stock disponible. Escríbeme para coordinar la entrega.');
  const sinStock = productPublicationText({ name: 'X', brand: null, price: 1, available: 0 });
  assert.ok(!sinStock.includes('Marca'));
  assert.ok(sinStock.endsWith('Escríbeme para consultar disponibilidad.'));
});
