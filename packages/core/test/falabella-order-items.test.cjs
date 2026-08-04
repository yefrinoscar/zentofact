const assert = require('node:assert/strict');
const test = require('node:test');

process.env.DATABASE_URL_POSTGRES ||= 'postgresql://test:test@127.0.0.1:5432/test';

const {
  falabellaCatalogVariant,
  falabellaOrderItemImageUrls,
  falabellaOrderItemName,
  falabellaOrderItemSellerSku,
  falabellaOrderItemVariant,
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

test('recupera color y talla desde el nombre completo del catálogo por SKU', () => {
  const product = {
    SellerSku: 'CM22111211',
    ShopSku: '140704198',
    Name: 'Camiseta Faja Reductora Remodela Abdomen Hombres Vivid Bvd / Negro / XL',
  };
  assert.deepEqual(falabellaCatalogVariant(product), {
    color: 'Negro',
    size: 'XL',
    label: 'Negro · XL',
    source: 'catalog-name',
  });
  assert.deepEqual(falabellaOrderItemVariant({ Sku: 'CM22111211' }, product), {
    color: 'Negro',
    size: 'XL',
    label: 'Negro · XL',
    source: 'catalog-name',
  });
  assert.equal(
    falabellaOrderItemName(
      { Name: 'Camiseta Faja Reductora Remodela Abdomen Hombres Vivid Bvd' },
      product.Name,
    ),
    'Camiseta Faja Reductora Remodela Abdomen Hombres Vivid Bvd - Negro XL',
  );
});

test('ignora marcadores vacíos de Falabella y usa la variante al final del nombre', () => {
  assert.deepEqual(
    falabellaCatalogVariant({
      SellerSku: 'CAM42123111',
      Name: 'Camiseta Faja Remodela Abdomen Hombres Bvd - Blanco M',
      Variation: '...',
    }),
    { color: 'Blanco', size: 'M', label: 'Blanco · M', source: 'catalog-name' },
  );
});

test('prioriza la variante exacta de la orden sobre el fallback del catálogo', () => {
  assert.deepEqual(
    falabellaOrderItemVariant(
      { Variation: { Color: 'Azul', Talla: 'M' } },
      { Name: 'Camiseta / Negro / XL' },
    ),
    { color: 'Azul', size: 'M', label: 'Azul · M', source: 'order' },
  );
});

test('lee atributos de catálogo representados como una lista nombre-valor', () => {
  assert.deepEqual(
    falabellaCatalogVariant({
      Name: 'Polo deportivo',
      ProductData: {
        Attributes: {
          Attribute: [
            { Name: 'Color', Value: 'Verde' },
            { Name: 'Talla', Value: 'L' },
          ],
        },
      },
    }),
    { color: 'Verde', size: 'L', label: 'Verde · L', source: 'catalog' },
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
