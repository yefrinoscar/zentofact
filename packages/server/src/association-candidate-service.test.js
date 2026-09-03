import assert from 'node:assert/strict';
import test from 'node:test';
import { listLiveAssociationCandidates } from './catalog/association-candidate-service.js';

const activeFalabellaProduct = (sellerSku, name) => ({
  sellerSku,
  shopSku: `SHOP-${sellerSku}`,
  name,
  images: [`https://images.example/${sellerSku}.jpg`],
  status: 'active',
  qcStatus: 'approved',
  businessUnits: [{
    operatorCode: 'fape',
    status: 'active',
    isPublished: 'true',
    price: 99,
  }],
});

test('busca en los catálogos reales y excluye publicaciones asociadas a cualquier master', async () => {
  const calls = [];
  const dependencies = {
    db: {
      async query() {
        return {
          rows: [
            { id: 10, channel_code: 'falabella', company_id: 1, seller_sku: 'F-USADO', status: 'active' },
            { id: 20, channel_code: 'ripley', company_id: 2, seller_sku: 'R-USADO', status: 'inactive' },
            { id: 21, channel_code: 'ripley', company_id: 2, seller_sku: 'R-LIBRE', status: 'unlinked' },
          ],
        };
      },
    },
    async listCompanies() {
      return [
        { id: 1, activo: true, nombreComercial: 'Falabella seller', falabellaApiUserId: 'configured', falabellaApiKey: 'configured' },
        { id: 2, activo: true, nombreComercial: 'Ripley seller', ripleyApiKey: 'configured' },
      ];
    },
    async falabellaGetProducts(input) {
      calls.push({ provider: 'falabella-products', input });
      return {
        ok: true,
        totalCount: 2,
        products: [
          activeFalabellaProduct('F-USADO', 'Producto usado'),
          activeFalabellaProduct('F-LIBRE', 'Producto nuevo Falabella'),
        ],
      };
    },
    async falabellaGetStock(input) {
      calls.push({ provider: 'falabella-stock', input });
      return {
        ok: true,
        stocks: input.sellerSkus.map((sellerSku) => ({ sellerSku, availableQuantity: 8 })),
      };
    },
    async listRipleyProducts(companyId, filters) {
      calls.push({ provider: 'ripley', companyId, filters });
      return {
        offers: [
          { sellerSku: 'R-USADO', productSku: 'P-USADO', productTitle: 'Producto usado', active: true, quantity: 5, imageUrl: null },
          { sellerSku: 'R-LIBRE', productSku: 'P-LIBRE', productTitle: 'Producto nuevo Ripley', active: true, quantity: 6, imageUrl: 'https://images.example/r-libre.jpg' },
        ],
      };
    },
    cache: new Map(),
  };

  const result = await listLiveAssociationCandidates({
    productId: 99,
    search: 'producto nuevo',
    availability: 'recommended',
    limit: 20,
    offset: 0,
  }, dependencies);

  assert.equal(result.totalCount, 2);
  assert.deepEqual(result.candidates.map((candidate) => ({
    channelCode: candidate.channelCode,
    sellerSku: candidate.sellerSku,
    candidateSource: candidate.candidateSource,
    id: candidate.id,
  })), [
    { channelCode: 'falabella', sellerSku: 'F-LIBRE', candidateSource: 'remote', id: 0 },
    { channelCode: 'ripley', sellerSku: 'R-LIBRE', candidateSource: 'catalog', id: 21 },
  ]);
  assert.equal(calls.some((call) => call.provider === 'falabella-products'), true);
  assert.equal(calls.some((call) => call.provider === 'falabella-stock'), true);
  assert.equal(calls.some((call) => call.provider === 'ripley' && call.filters.all === true), true);
});

test('filtra el catálogo remoto completo antes de paginar los resultados', async () => {
  const products = Array.from({ length: 25 }, (_, index) => activeFalabellaProduct(
    `SKU-${index + 1}`,
    index === 24 ? 'Aguja encontrada al final' : `Producto ${index + 1}`,
  ));
  const result = await listLiveAssociationCandidates({
    productId: 99,
    channelCode: 'falabella',
    search: 'aguja encontrada',
    availability: 'recommended',
    limit: 20,
    offset: 0,
  }, {
    db: { async query() { return { rows: [] }; } },
    async listCompanies() {
      return [{ id: 1, activo: true, falabellaApiUserId: 'configured', falabellaApiKey: 'configured' }];
    },
    async falabellaGetProducts() { return { ok: true, totalCount: products.length, products }; },
    async falabellaGetStock(input) {
      return { ok: true, stocks: input.sellerSkus.map((sellerSku) => ({ sellerSku, availableQuantity: 1 })) };
    },
    async listRipleyProducts() { throw new Error('Ripley no debía consultarse.'); },
    cache: new Map(),
  });

  assert.equal(result.totalCount, 1);
  assert.equal(result.candidates[0].sellerSku, 'SKU-25');
});

test('informa coincidencias ocultas por el filtro de disponibilidad', async () => {
  const inactiveProduct = {
    ...activeFalabellaProduct('F-INACTIVO', 'Coche con stock'),
    status: 'inactive',
    businessUnits: [{ operatorCode: 'fape', status: 'inactive', isPublished: '1', stock: 12 }],
  };
  const result = await listLiveAssociationCandidates({
    productId: 99,
    channelCode: 'falabella',
    search: 'coche',
    availability: 'recommended',
    limit: 20,
    offset: 0,
  }, {
    db: { async query() { return { rows: [] }; } },
    async listCompanies() {
      return [{ id: 1, activo: true, falabellaApiUserId: 'configured', falabellaApiKey: 'configured' }];
    },
    async falabellaGetProducts() { return { ok: true, totalCount: 1, products: [inactiveProduct] }; },
    async falabellaGetStock() {
      return { ok: true, stocks: [{ sellerSku: 'F-INACTIVO', availableQuantity: 12 }] };
    },
    async listRipleyProducts() { throw new Error('Ripley no debía consultarse.'); },
    cache: new Map(),
  });

  assert.equal(result.totalCount, 0);
  assert.equal(result.hiddenByAvailabilityCount, 1);
});

test('una búsqueda explícita muestra publicaciones vinculadas a otro master para poder reasociarlas', async () => {
  const dependencies = {
    db: {
      async query() {
        return {
          rows: [{
            id: 8997,
            product_id: 78,
            channel_code: 'ripley',
            company_id: 1,
            seller_sku: 'S119231',
            status: 'active',
            linked_product_sku: 'H36',
            linked_product_name: 'Escritorio Gamer Moderno para PC y Consola Ergonómico',
          }],
        };
      },
    },
    async listCompanies() {
      return [{ id: 1, activo: true, nombreComercial: 'LIMBO', ripleyApiKey: 'configured' }];
    },
    async falabellaGetProducts() { throw new Error('Falabella no debía consultarse.'); },
    async falabellaGetStock() { throw new Error('Falabella no debía consultarse.'); },
    async listRipleyProducts() {
      return {
        offers: [{
          sellerSku: 'S119231',
          productSku: 'PMP20000723350-1',
          productTitle: 'ESCRITORIO GAMER MODERNO PARA PC Y CONSOLA ERGONÓMICO',
          active: true,
          quantity: 96,
        }],
      };
    },
    cache: new Map(),
  };

  const result = await listLiveAssociationCandidates({
    productId: 9,
    channelCode: 'ripley',
    search: 'escritorio',
    availability: 'recommended',
  }, dependencies);

  assert.equal(result.totalCount, 1);
  assert.deepEqual(result.candidates[0].association, {
    kind: 'linked_elsewhere',
    productId: 78,
    mainSku: 'H36',
    productName: 'Escritorio Gamer Moderno para PC y Consola Ergonómico',
  });
});
