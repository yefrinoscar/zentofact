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
