const assert = require('node:assert/strict');
const test = require('node:test');

process.env.DATABASE_URL_POSTGRES ||= 'postgresql://test:test@127.0.0.1:5432/test';

const {
  falabellaOrderItemSellerSku,
} = require('../dist/services/falabella.service.js');

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
