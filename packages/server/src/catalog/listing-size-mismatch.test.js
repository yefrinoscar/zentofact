import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findListingSizeMismatches,
  listListingSizeMismatches,
  normalizeSize,
  sizeFromText,
} from './listing-size-mismatch.js';

function listingRow(overrides = {}) {
  return {
    listing_id: 1,
    product_id: 10,
    main_sku: 'AG164',
    product_name: 'Guantes · Negro · M',
    channel_code: 'falabella',
    company_id: 7,
    company_name: 'LIMBO',
    seller_sku: 'MIT22463316',
    shop_sku: '140381669',
    title: 'Guantes Tácticos Mitones Moto Gym Bicicleta - Negro M',
    listing_size: 'M',
    master_size: 'L',
    ...overrides,
  };
}

test('normalizeSize trata tallas universales como equivalentes y quita acentos', () => {
  assert.equal(normalizeSize('Talla única'), '');
  assert.equal(normalizeSize('ESTÁNDAR'), '');
  assert.equal(normalizeSize('m'), 'M');
  assert.equal(normalizeSize('  '), null);
  assert.equal(normalizeSize('1'), null);
});

test('sizeFromText encuentra la talla sin confundir palabras', () => {
  assert.equal(sizeFromText('Guantes Deportes Sport - Negro M'), 'M');
  assert.equal(sizeFromText('GUANTES ... TALLA L'), 'L');
  assert.equal(sizeFromText('Guantes Moto Gym Bicicleta'), null);
  assert.equal(sizeFromText('Guantes XXL'), 'XXL');
});

test('findListingSizeMismatches marca una publicación M bajo un maestro L', () => {
  const result = findListingSizeMismatches([listingRow()]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    productId: 10,
    mainSku: 'AG164',
    productName: 'Guantes · Negro · M',
    listingId: 1,
    channelCode: 'falabella',
    companyId: 7,
    companyName: 'LIMBO',
    sellerSku: 'MIT22463316',
    shopSku: '140381669',
    title: 'Guantes Tácticos Mitones Moto Gym Bicicleta - Negro M',
    listingSize: 'M',
    masterSize: 'L',
  });
});

test('findListingSizeMismatches ignora coincidencias, universales y sin talla', () => {
  const result = findListingSizeMismatches([
    listingRow({ listing_id: 2, listing_size: 'L' }),
    listingRow({ listing_id: 3, listing_size: 'Única', master_size: 'L' }),
    listingRow({ listing_id: 4, master_size: 'Talla única', listing_size: 'M' }),
    listingRow({ listing_id: 5, master_size: null }),
    listingRow({ listing_id: 6, listing_size: null, title: 'Guantes Moto Gym Bicicleta' }),
  ]);
  assert.deepEqual(result, []);
});

test('findListingSizeMismatches usa el título cuando la metadata no trae talla', () => {
  const result = findListingSizeMismatches([
    listingRow({ listing_id: 7, listing_size: null, title: 'GUANTES ... TALLA M', master_size: 'L' }),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].listingSize, 'M');
});

test('findListingSizeMismatches ignora metadata.size no reconocida y usa el título', () => {
  const result = findListingSizeMismatches([
    listingRow({ listing_id: 8, listing_size: '1', title: 'Camiseta Reductora Negra talla M', master_size: 'M' }),
    listingRow({ listing_id: 9, listing_size: '1', title: 'Camiseta Reductora Negra talla M', master_size: 'L' }),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].listingId, 9);
  assert.equal(result[0].listingSize, 'M');
});

test('listListingSizeMismatches consulta publicaciones activas con talla de maestro', async () => {
  const queries = [];
  const db = {
    query: async (sql) => {
      queries.push(String(sql));
      return { rows: [listingRow()] };
    },
  };
  const result = await listListingSizeMismatches(db);
  assert.equal(result.total, 1);
  assert.match(queries[0], /from product_listings l/);
  assert.match(queries[0], /l\.status = 'active'/);
  assert.match(queries[0], /p\.attributes->>'size'/);
});
