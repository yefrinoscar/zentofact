import assert from 'node:assert/strict';
import test from 'node:test';
import { listRipleyProducts } from './ripley-catalog.js';

test('solicita todas las ofertas de Ripley sólo cuando all=true', async () => {
  const calls = [];
  const result = await listRipleyProducts(4, { all: 'true' }, {
    getCompany: async () => ({ activo: true, ripleyApiKey: 'secret' }),
    client: {
      listAllOffers: async () => { calls.push('all'); return [{ sellerSku: 'SKU-1' }]; },
      listOffers: async () => { calls.push('page'); return { offers: [] }; },
    },
  });
  assert.deepEqual(calls, ['all']);
  assert.deepEqual(result, { companyId: 4, totalCount: 1, offers: [{ sellerSku: 'SKU-1' }] });
});
