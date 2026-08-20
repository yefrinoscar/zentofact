import assert from 'node:assert/strict';
import test from 'node:test';
import { RipleyApiClient } from '../dist/index.js';

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('lista las ofertas de Ripley con autenticación y paginación Mirakl', async () => {
  let request;
  const client = new RipleyApiClient({
    baseUrl: 'https://marketplace.ripley.test', apiKey: 'secret', shopId: 17,
    fetchImpl: async (url, init) => {
      request = { url: new URL(url), init };
      return response({ total_count: 1, offers: [{ offer_id: 11, sku: 'SELLER-1', product_sku: 'P-1', product_title: 'Producto', active: true, quantity: 4, price: 29.9 }] });
    },
  });

  const page = await client.listOffers({ max: 50, offset: 100 });
  assert.equal(request.url.pathname, '/api/offers');
  assert.equal(request.url.searchParams.get('shop_id'), '17');
  assert.equal(request.url.searchParams.get('max'), '50');
  assert.equal(request.url.searchParams.get('offset'), '100');
  assert.equal(request.init.headers.Authorization, 'secret');
  assert.deepEqual(page.offers[0], {
    offerId: '11', sellerSku: 'SELLER-1', productSku: 'P-1', productTitle: 'Producto', active: true, quantity: 4, price: 29.9,
    raw: { offer_id: 11, sku: 'SELLER-1', product_sku: 'P-1', product_title: 'Producto', active: true, quantity: 4, price: 29.9 },
  });
});

test('trae todas las páginas de ofertas', async () => {
  const calls = [];
  const client = new RipleyApiClient({
    baseUrl: 'https://marketplace.ripley.test', apiKey: 'secret',
    fetchImpl: async (url) => {
      const offset = Number(new URL(url).searchParams.get('offset'));
      calls.push(offset);
      const offers = offset === 0
        ? Array.from({ length: 100 }, (_, index) => ({ sku: `SKU-${index}` }))
        : [{ sku: 'SKU-100' }];
      return response({ total_count: 101, offers });
    },
  });

  const offers = await client.listAllOffers();
  assert.equal(offers.length, 101);
  assert.deepEqual(calls, [0, 100]);
});
