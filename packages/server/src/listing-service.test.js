import assert from 'node:assert/strict';
import test from 'node:test';
import { linkListing } from './catalog/listing-service.js';

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
