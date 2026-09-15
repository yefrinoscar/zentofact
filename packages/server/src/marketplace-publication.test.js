import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMarketplaceProduct,
  marketplacePublicationMutationEnabled,
  updateMarketplacePublication,
  updateMarketplaceSellerStock,
} from './catalog/marketplace-publication.js';

test('publication mutation stays off unless the env flag is explicitly true', () => {
  assert.equal(marketplacePublicationMutationEnabled({}), false);
  assert.equal(marketplacePublicationMutationEnabled({ MARKETPLACE_PUBLICATION_MUTATION_ENABLED: '' }), false);
  assert.equal(marketplacePublicationMutationEnabled({ MARKETPLACE_PUBLICATION_MUTATION_ENABLED: 'false' }), false);
  assert.equal(marketplacePublicationMutationEnabled({ MARKETPLACE_PUBLICATION_MUTATION_ENABLED: 'true' }), true);
});

test('createMarketplaceProduct no llama al seller API si la escritura está apagada', async () => {
  let called = false;
  await assert.rejects(
    () => createMarketplaceProduct(async () => { called = true; }, { companyId: 1, product: { sellerSku: 'ABC' } }, {}),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, 'marketplace_mutation_disabled');
      assert.match(error.message, /desactivada/);
      return true;
    },
  );
  assert.equal(called, false);
});

test('createMarketplaceProduct calls the seller API only when the flag is on', async () => {
  const payload = { companyId: 7, product: { sellerSku: 'LIMBO-7-AG3' } };
  const result = await createMarketplaceProduct(
    async (input) => ({ ok: true, input }),
    payload,
    { MARKETPLACE_PUBLICATION_MUTATION_ENABLED: 'true' },
  );
  assert.deepEqual(result, { ok: true, input: payload });
});

function listingDb() {
  const listing = {
    id: 18,
    product_id: 12,
    channel_code: 'falabella',
    company_id: 4,
    seller_sku: 'SKU-18',
    status: 'active',
    marketplace_quantity: 5,
    metadata: {
      fulfillmentQuantity: 2,
      sellerWarehouses: [{ facilityId: 'GSC-PE-1', quantity: 3 }],
    },
  };
  return {
    updates: [],
    async query(sql, params) {
      if (sql.startsWith('select * from product_listings')) return { rows: [listing] };
      if (sql.startsWith('update product_listings')) {
        this.updates.push({ sql, params });
        if (sql.includes('marketplace_quantity')) {
          return { rows: [{ ...listing, marketplace_quantity: params[0], metadata: JSON.parse(params[1]) }] };
        }
        if (sql.includes('marketplace_synced_at')) {
          return { rows: [{ ...listing, metadata: JSON.parse(params[0]) }] };
        }
        return { rows: [{ ...listing, status: params[0], metadata: JSON.parse(params[1]) }] };
      }
      return { rows: [] };
    },
  };
}

test('encola el stock y responde sin llamar a Falabella dentro del request', async () => {
  const db = listingDb();
  let queued;
  const result = await updateMarketplaceSellerStock(18, { quantity: 7 }, {
    db,
    enabled: true,
    userId: 'user-1',
    enqueue: async (input) => {
      queued = input;
      return { id: 41, status: 'pending' };
    },
  });

  assert.deepEqual(queued, {
    listingId: 18,
    userId: 'user-1',
    kind: 'stock',
    target: { quantity: 7 },
  });
  assert.deepEqual(result, { queued: true, jobId: 41, status: 'pending' });
  assert.equal(db.updates.length, 0);
});

test('rechaza stock inválido antes de encolarlo', async () => {
  let called = false;
  await assert.rejects(
    () => updateMarketplaceSellerStock(18, { quantity: 1.5 }, {
      enabled: true,
      enqueue: async () => { called = true; },
    }),
    /entero mayor o igual a 0/,
  );
  assert.equal(called, false);
});

test('encola el estado solicitado por el switch', async () => {
  const db = listingDb();
  let queued;
  const result = await updateMarketplacePublication(18, { visible: false }, {
    db,
    enabled: true,
    userId: 'user-1',
    enqueue: async (input) => {
      queued = input;
      return { id: 42, status: 'pending' };
    },
  });

  assert.deepEqual(queued, {
    listingId: 18,
    userId: 'user-1',
    kind: 'publication',
    target: { visible: false },
  });
  assert.deepEqual(result, { queued: true, jobId: 42, status: 'pending' });
});
