import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMarketplaceProduct,
  marketplacePublicationMutationEnabled,
} from './catalog/marketplace-publication.js';

test('publication mutation stays off unless the env flag is explicitly true', () => {
  assert.equal(marketplacePublicationMutationEnabled({}), false);
  assert.equal(marketplacePublicationMutationEnabled({ MARKETPLACE_PUBLICATION_MUTATION_ENABLED: '' }), false);
  assert.equal(marketplacePublicationMutationEnabled({ MARKETPLACE_PUBLICATION_MUTATION_ENABLED: 'false' }), false);
  assert.equal(marketplacePublicationMutationEnabled({ MARKETPLACE_PUBLICATION_MUTATION_ENABLED: 'true' }), true);
});

test('createMarketplaceProduct does not call the seller API while visual-only', async () => {
  let called = false;
  await assert.rejects(
    () => createMarketplaceProduct(async () => { called = true; }, { companyId: 1, product: { sellerSku: 'ABC' } }, {}),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, 'marketplace_publication_visual_only');
      assert.match(error.message, /solo simula/);
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
