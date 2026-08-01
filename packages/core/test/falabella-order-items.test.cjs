const assert = require('node:assert/strict');
const test = require('node:test');

process.env.DATABASE_URL_POSTGRES ||= 'postgresql://test:test@127.0.0.1:5432/test';

const {
  falabellaOrderItemImageUrls,
  falabellaOrderItemName,
  falabellaOrderItemSellerSku,
} = require('../dist/services/falabella.service.js');

test('prioriza el nombre exacto comprado sobre el nombre genérico del catálogo', () => {
  assert.equal(
    falabellaOrderItemName(
      { Name: 'Camiseta Faja Remodela Abdomen Hombres Bvd - Blanco M' },
      'Camiseta Faja Remodela Abdomen Hombres Bvd',
    ),
    'Camiseta Faja Remodela Abdomen Hombres Bvd - Blanco M',
  );
});

test('agrega color y talla enviados por separado en Variation', () => {
  assert.equal(
    falabellaOrderItemName({
      Name: 'Camiseta Faja Reductora Remodela Abdomen Hombres Vivid Bvd',
      Variation: '{"color":{"name":"Blanco","code":"#FFFFFF"},"size":"L"}',
    }),
    'Camiseta Faja Reductora Remodela Abdomen Hombres Vivid Bvd - Blanco L',
  );
});

test('no duplica la variante cuando Falabella ya la incluyo en el nombre', () => {
  assert.equal(
    falabellaOrderItemName({
      Name: 'Camiseta Faja Remodela Abdomen Hombres Bvd - Blanco M',
      Variation: '{"color":{"name":"Blanco","code":"#FFFFFF"},"size":"M"}',
    }),
    'Camiseta Faja Remodela Abdomen Hombres Bvd - Blanco M',
  );
});

test('conserva varias fuentes de foto y agrega el medio oficial por ShopSku', () => {
  assert.deepEqual(
    falabellaOrderItemImageUrls(
      { ImageUrl: 'https://example.com/orden.jpg', ShopSku: '140822979' },
      ['https://example.com/catalogo.jpg'],
    ),
    [
      'https://example.com/orden.jpg',
      'https://example.com/catalogo.jpg',
      'https://media.falabella.com/falabellaPE/140822979_01',
      'https://media.falabella.com/falabellaPE/140822979_1',
    ],
  );
});

test('usa el SKU del vendedor para consultar el catálogo antes que el ShopSku', () => {
  assert.equal(falabellaOrderItemSellerSku({
    Sku: 'EG122114',
    ShopSku: '140682097',
  }), 'EG122114');
});

test('conserva compatibilidad con SellerSku y usa ShopSku solo como último recurso', () => {
  assert.equal(falabellaOrderItemSellerSku({
    SellerSku: 'SELLER-1',
    Sku: 'SKU-1',
    ShopSku: 'SHOP-1',
  }), 'SELLER-1');
  assert.equal(falabellaOrderItemSellerSku({ ShopSku: 'SHOP-ONLY' }), 'SHOP-ONLY');
});
