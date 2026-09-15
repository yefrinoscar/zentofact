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

test('confirma UpdateStock con GetStock antes de guardar el snapshot local', async () => {
  const db = listingDb();
  let sent;
  let stockReads = 0;
  const result = await updateMarketplaceSellerStock(18, { quantity: 7 }, {
    db,
    enabled: true,
    updateStock: async (input) => {
      sent = input;
      return { ok: true, requestId: 'stock-request-1' };
    },
    getStock: async () => {
      stockReads += 1;
      return {
        ok: true,
        stocks: [{
          sellerSku: 'SKU-18',
          sellerWarehouseQuantity: stockReads === 1 ? 3 : 7,
          fulfillmentQuantity: 2,
        }],
      };
    },
    wait: async () => {},
    confirmationAttempts: 2,
  });

  assert.deepEqual(sent, {
    companyId: 4,
    sellerSku: 'SKU-18',
    quantity: 7,
    facilityId: 'GSC-PE-1',
  });
  assert.equal(stockReads, 2);
  assert.equal(result.listing.marketplaceQuantity, 5);
  assert.equal(result.listing.metadata.sellerWarehouseQuantity, 7);
  assert.equal(result.listing.metadata.fulfillmentQuantity, 2);
  assert.equal(result.listing.metadata.stockSource, 'falabella_get_stock_confirmed');
  assert.equal(result.confirmed, true);
  assert.equal(db.updates.length, 1);
});

test('no cambia el snapshot cuando Falabella acepta UpdateStock pero GetStock no lo confirma', async () => {
  const db = listingDb();

  await assert.rejects(
    () => updateMarketplaceSellerStock(18, { quantity: 7 }, {
      db,
      enabled: true,
      updateStock: async () => ({ ok: true, requestId: 'stock-request-2' }),
      getStock: async () => ({
        ok: true,
        stocks: [{ sellerSku: 'SKU-18', sellerWarehouseQuantity: 3, fulfillmentQuantity: 2 }],
      }),
      wait: async () => {},
      confirmationAttempts: 2,
    }),
    (error) => {
      assert.equal(error.status, 504);
      assert.match(error.message, /no confirmó/i);
      return true;
    },
  );
  assert.equal(db.updates.length, 0);
});

test('no cambia el snapshot si Falabella rechaza el stock', async () => {
  const db = listingDb();

  await assert.rejects(
    () => updateMarketplaceSellerStock(18, { quantity: 7 }, {
      db,
      enabled: true,
      updateStock: async () => ({ ok: false, error: { Head: { ErrorMessage: 'SKU inválido' } } }),
    }),
    /SKU inválido/,
  );
  assert.equal(db.updates.length, 0);
});

test('confirma active o inactive con GetProducts antes de cambiar el switch local', async () => {
  const db = listingDb();
  let sent;
  let productReads = 0;
  const result = await updateMarketplacePublication(18, { visible: false }, {
    db,
    enabled: true,
    updateStatus: async (input) => {
      sent = input;
      return { ok: true, requestId: 'publication-request-1' };
    },
    getProducts: async () => {
      productReads += 1;
      return {
        ok: true,
        products: [{
          sellerSku: 'SKU-18',
          status: 'active',
          qcStatus: 'approved',
          businessUnits: [{ operatorCode: 'fape', status: productReads === 1 ? 'active' : 'inactive', isPublished: productReads === 1 ? 'true' : 'false' }],
        }],
      };
    },
    wait: async () => {},
    confirmationAttempts: 2,
  });

  assert.deepEqual(sent, {
    companyId: 4,
    sellerSku: 'SKU-18',
    status: 'inactive',
  });
  assert.equal(productReads, 2);
  assert.equal(result.listing.status, 'inactive');
  assert.equal(result.listing.metadata.isPublished, false);
  assert.equal(result.confirmed, true);
});
