import assert from 'node:assert/strict';
import test from 'node:test';
import { listRipleyProducts } from './ripley-catalog.js';

test('solicita todas las ofertas de Ripley sólo cuando all=true', async () => {
  const calls = [];
  const result = await listRipleyProducts(4, { all: 'true' }, {
    getCompany: async () => ({ activo: true, ripleyApiKey: 'secret' }),
    client: {
      listAllOffers: async () => { calls.push('all'); return [{ sellerSku: 'SKU-1' }]; },
      listProductContents: async () => [],
      listOffers: async () => { calls.push('page'); return { offers: [] }; },
    },
  });
  assert.deepEqual(calls, ['all']);
  assert.deepEqual(result, { companyId: 4, totalCount: 1, offers: [{ sellerSku: 'SKU-1' }] });
});

test('combina la oferta OF21 con la imagen P11', async () => {
  const result = await listRipleyProducts(4, { max: 20, offset: 0 }, {
    getCompany: async () => ({ activo: true, ripleyApiKey: 'secret' }),
    client: {
      listOffers: async () => ({ totalCount: 1, offset: 0, max: 20, offers: [{ sellerSku: 'S-1', productSku: 'P-1', productTitle: 'Oferta', imageUrl: null }] }),
      listProductContents: async () => [{ productSku: 'P-1', productTitle: 'Ficha', imageUrl: 'https://dam.ripley.test/p.jpg' }],
    },
  });
  assert.equal(result.offers[0].productTitle, 'Ficha');
  assert.equal(result.offers[0].imageUrl, 'https://dam.ripley.test/p.jpg');
});
