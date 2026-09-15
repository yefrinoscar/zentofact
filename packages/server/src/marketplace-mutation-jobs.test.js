import test from 'node:test';
import assert from 'node:assert/strict';
import { processMarketplaceMutationJobs } from './catalog/marketplace-mutation-jobs.js';

function jobDb(kind = 'stock') {
  const listing = {
    id: 18,
    product_id: 12,
    company_id: 4,
    seller_sku: 'SKU-18',
    status: 'active',
    marketplace_quantity: 5,
    metadata: { sellerWarehouseQuantity: 3, fulfillmentQuantity: 2, isPublished: true },
  };
  const job = {
    id: 41,
    listing_id: 18,
    requested_by_user_id: 'user-1',
    kind,
    target: kind === 'stock' ? { quantity: 7 } : { visible: false },
    phase: 'submit',
    provider_request_id: null,
    status: 'pending',
    attempts: 0,
  };
  return {
    job,
    listing,
    calls: [],
    notices: [],
    async query(sql, params = []) {
      this.calls.push(sql);
      if (sql.includes("status='processing' and updated_at <")) return { rows: [] };
      if (sql.startsWith('update marketplace_mutation_jobs set status=\'processing\'')) {
        if (job.status !== 'pending') return { rows: [] };
        job.status = 'processing';
        job.attempts += 1;
        return { rows: [{ ...job }] };
      }
      if (sql.startsWith('select l.*,p.id as product_id')) return { rows: [{ ...listing }] };
      if (sql.includes("phase='verify'")) {
        job.status = 'pending';
        job.phase = 'verify';
        job.provider_request_id = params[1];
        return { rows: [] };
      }
      if (sql.startsWith('select * from product_listings')) return { rows: [{ ...listing }] };
      if (sql.startsWith('update product_listings set')) {
        if (sql.includes('marketplace_synced_at')) listing.metadata = JSON.parse(params[0]);
        else {
          listing.status = params[0];
          listing.metadata = JSON.parse(params[1]);
        }
        return { rows: [{ ...listing }] };
      }
      if (sql.includes('finished_at=now()')) {
        job.status = params[1];
        this.notices.push({ id: params[4], kind: params[6], severity: params[7], title: params[8] });
        return { rows: [] };
      }
      if (sql.includes("set status='pending',last_error")) {
        job.status = 'pending';
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

test('espera el feed antes de consultar y guardar el stock', async () => {
  const db = jobDb('stock');
  const sequence = [];
  let feedReads = 0;
  const adapters = {
    updateStock: async () => { sequence.push('submit'); return { ok: true, requestId: 'feed-41' }; },
    updateStatus: async () => { throw new Error('no corresponde'); },
    getFeedStatus: async () => {
      sequence.push('feed');
      feedReads += 1;
      return { ok: true, feed: { status: feedReads === 1 ? 'Processing' : 'Finished', failedRecords: 0 } };
    },
    getStock: async () => { sequence.push('detail'); return { ok: true, stocks: [{ sellerSku: 'SKU-18', sellerWarehouseQuantity: 7 }] }; },
    getProducts: async () => { throw new Error('no corresponde'); },
  };

  await processMarketplaceMutationJobs({ adapters }, db);
  assert.equal(db.job.phase, 'verify');
  assert.equal(db.listing.metadata.sellerWarehouseQuantity, 3);
  await processMarketplaceMutationJobs({ adapters }, db);
  assert.deepEqual(sequence, ['submit', 'feed']);
  assert.equal(db.listing.metadata.sellerWarehouseQuantity, 3);
  await processMarketplaceMutationJobs({ adapters }, db);

  assert.deepEqual(sequence, ['submit', 'feed', 'feed', 'detail']);
  assert.equal(db.job.status, 'succeeded');
  assert.equal(db.listing.marketplace_quantity, 5);
  assert.equal(db.listing.metadata.sellerWarehouseQuantity, 7);
  assert.deepEqual(db.notices, [{
    id: 'marketplace_mutation:41:succeeded',
    kind: 'marketplace_mutation',
    severity: 'success',
    title: 'Stock actualizado en Falabella',
  }]);
});

test('un feed fallido no consulta el detalle y genera un aviso', async () => {
  const db = jobDb('publication');
  db.job.phase = 'verify';
  db.job.provider_request_id = 'feed-42';
  let detailReads = 0;
  await processMarketplaceMutationJobs({ adapters: {
    updateStock: async () => ({ ok: true }),
    updateStatus: async () => ({ ok: true }),
    getFeedStatus: async () => ({ ok: true, feed: { status: 'Finished', failedRecords: 1 } }),
    getStock: async () => { detailReads += 1; return { ok: true, stocks: [] }; },
    getProducts: async () => { detailReads += 1; return { ok: true, products: [] }; },
  } }, db);

  assert.equal(detailReads, 0);
  assert.equal(db.job.status, 'failed');
  assert.equal(db.notices[0].severity, 'critical');
  assert.equal(db.notices[0].title, 'Falabella no actualizó la publicación');
});
