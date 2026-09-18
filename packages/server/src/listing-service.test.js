import assert from 'node:assert/strict';
import test from 'node:test';
import { linkListing, updateListingPublicationState, updateListingSellerStock } from './catalog/listing-service.js';

test('no reasocia una publicación que sigue vinculada a otro producto', async () => {
  const queries = [];
  const db = {
    async query(sql) {
      queries.push(sql);
      if (sql.startsWith('select * from product_listings')) {
        return { rows: [{ id: 18, product_id: 7, company_id: 4, status: 'active' }] };
      }
      return { rows: [] };
    },
  };

  await assert.rejects(
    () => linkListing({ listingId: 18, productId: 12 }, db),
    (error) => error?.status === 409 && error?.code === 'listing_already_linked',
  );
  assert.equal(queries.length, 1);
});

test('reasocia una publicación cuando el operador confirma el nuevo master', async () => {
  const queries = [];
  const db = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.startsWith('select * from product_listings')) {
        return { rows: [{ id: 18, product_id: 7, company_id: 4, status: 'active' }] };
      }
      if (sql.startsWith('select')) return { rows: [{ product_exists: true, company_exists: true, account_exists: true }] };
      if (sql.startsWith('update product_listings')) return { rows: [{ id: 18, product_id: 12, company_id: 4, status: 'active' }] };
      return { rows: [] };
    },
  };

  const listing = await linkListing({ listingId: 18, productId: 12, allowReassign: true }, db);

  assert.equal(listing.productId, 12);
  assert.equal(queries.some(({ sql }) => sql.includes("where id=$2")), true);
});

test('actualiza solo el snapshot del stock seller sin recalcular el total del listing', async () => {
  const queries = [];
  const db = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.startsWith('select * from product_listings')) {
        return {
          rows: [{
            id: 18,
            product_id: 12,
            company_id: 4,
            marketplace_quantity: 8,
            metadata: { sellerWarehouseQuantity: 5, fulfillmentQuantity: 3, isPublished: true },
          }],
        };
      }
      if (sql.startsWith('update product_listings')) {
        return {
          rows: [{
            id: 18,
            product_id: 12,
            company_id: 4,
            marketplace_quantity: 8,
            metadata: JSON.parse(params[0]),
          }],
        };
      }
      return { rows: [] };
    },
  };

  const listing = await updateListingSellerStock(18, { quantity: 7, requestId: 'stock-request-1' }, db);

  assert.equal(listing.marketplaceQuantity, 8);
  assert.equal(listing.metadata.sellerWarehouseQuantity, 7);
  assert.equal(listing.metadata.fulfillmentQuantity, 3);
  assert.equal(listing.metadata.isPublished, true);
  assert.equal(listing.metadata.stockSource, 'falabella_get_stock_confirmed');
  assert.equal(listing.metadata.stockMutationRequestId, 'stock-request-1');
  assert.match(listing.metadata.stockMutationSubmittedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('rechaza stock seller negativo o fraccionario', async () => {
  const db = { query: async () => ({ rows: [] }) };

  await assert.rejects(
    () => updateListingSellerStock(18, { quantity: -1 }, db),
    /entero mayor o igual a 0/,
  );
  await assert.rejects(
    () => updateListingSellerStock(18, { quantity: 1.5 }, db),
    /entero mayor o igual a 0/,
  );
});

test('registra el estado enviado a Falabella sin desasociar el listing', async () => {
  const db = {
    async query(sql, params) {
      if (sql.startsWith('select * from product_listings')) {
        return { rows: [{ id: 18, product_id: 12, company_id: 4, status: 'active', metadata: { qcStatus: 'approved' } }] };
      }
      if (sql.startsWith('update product_listings')) {
        return {
          rows: [{
            id: 18,
            product_id: 12,
            company_id: 4,
            status: params[0],
            metadata: JSON.parse(params[1]),
          }],
        };
      }
      return { rows: [] };
    },
  };

  const listing = await updateListingPublicationState(18, {
    visible: false,
    requestId: 'publication-request-1',
  }, db);

  assert.equal(listing.status, 'inactive');
  assert.equal(listing.metadata.isPublished, false);
  assert.equal(listing.metadata.marketplaceStatus, 'inactive');
  assert.equal(listing.metadata.publicationMutationRequestId, 'publication-request-1');
});
