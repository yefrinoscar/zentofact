import { falabellaPublicationState } from './listing-snapshot-service.js';
import { updateListingPublicationState, updateListingSellerStock } from './listing-service.js';
import { httpError, jsonObject, loadCore, positiveInt } from './utils.js';

const WORKER_INTERVAL_MS = 2_000;
const MAX_ATTEMPTS = 60;

function target(db) {
  return db || loadCore().then((core) => core.pool);
}

export async function ensureMarketplaceMutationJobTables(db) {
  const client = await target(db);
  await client.query(`
    create table if not exists marketplace_mutation_jobs (
      id bigserial primary key,
      listing_id bigint not null references product_listings(id) on delete cascade,
      requested_by_user_id text not null,
      kind text not null check (kind in ('stock','publication')),
      target jsonb not null,
      phase text not null default 'submit' check (phase in ('submit','verify')),
      provider_request_id text,
      status text not null default 'pending' check (status in ('pending','processing','succeeded','failed')),
      attempts integer not null default 0,
      next_attempt_at timestamptz,
      last_error text,
      result jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      finished_at timestamptz
    );
    create unique index if not exists uq_marketplace_mutation_jobs_active
      on marketplace_mutation_jobs (listing_id, kind)
      where status in ('pending','processing');
    create index if not exists idx_marketplace_mutation_jobs_pending
      on marketplace_mutation_jobs (status, next_attempt_at, created_at);
  `);
}

export async function enqueueMarketplaceMutation(input, db) {
  const client = await target(db);
  const userId = String(input.userId || '').trim();
  if (!userId) throw httpError('No autenticado.', 401);
  try {
    const result = await client.query(
      `insert into marketplace_mutation_jobs (listing_id, requested_by_user_id, kind, target)
       values ($1,$2,$3,$4::jsonb) returning id, status, created_at`,
      [positiveInt(input.listingId, 'listingId'), userId, input.kind, JSON.stringify(input.target)],
    );
    return { id: Number(result.rows[0].id), status: result.rows[0].status, createdAt: result.rows[0].created_at };
  } catch (error) {
    if (error?.code === '23505') throw httpError('Esta publicación ya tiene una actualización pendiente.', 409, 'marketplace_mutation_pending');
    throw error;
  }
}

function providerError(response) {
  return response?.error?.Head?.ErrorMessage || response?.error?.message || (typeof response?.error === 'string' ? response.error : '');
}

function accepted(response, action) {
  if (response?.ok === true) return;
  throw new Error(providerError(response) || `Falabella no aceptó ${action}.`);
}

function sameSku(left, right) {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
}

function feedFailed(feed) {
  return /fail|error|cancel|reject/i.test(String(feed?.status || '')) || Number(feed?.failedRecords || 0) > 0;
}

function feedPending(feed) {
  const status = String(feed?.status || '').trim();
  return status && !/finish|complete|success/i.test(status);
}

function listingFacilityId(listing) {
  const warehouses = jsonObject(listing.metadata).sellerWarehouses;
  if (!Array.isArray(warehouses) || warehouses.length !== 1) return null;
  const warehouse = jsonObject(warehouses[0]);
  return String(warehouse.facilityId || warehouse.FacilityID || '').trim() || null;
}

function notification(job, outcome, message) {
  const stock = job.kind === 'stock';
  return {
    id: `marketplace_mutation:${job.id}:${outcome}`,
    userId: job.requested_by_user_id,
    kind: 'marketplace_mutation',
    severity: outcome === 'succeeded' ? 'success' : 'critical',
    title: outcome === 'succeeded'
      ? (stock ? 'Stock actualizado en Falabella' : 'Publicación actualizada en Falabella')
      : (stock ? 'Falabella no actualizó el stock' : 'Falabella no actualizó la publicación'),
    body: message,
    href: '/productos',
    moduleLabel: 'Catálogo',
  };
}

async function finish(job, status, message, result, db) {
  const notice = notification(job, status, message);
  await db.query(
    `with notice as (
       insert into operator_notifications (id,user_id,kind,severity,title,body,href,module_label)
       values ($5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (id) do nothing
     )
     update marketplace_mutation_jobs
        set status=$2,last_error=$3,result=$4::jsonb,finished_at=now(),updated_at=now()
      where id=$1`,
    [
      job.id,
      status,
      status === 'failed' ? message : null,
      JSON.stringify(result || {}),
      notice.id,
      notice.userId,
      notice.kind,
      notice.severity,
      notice.title,
      notice.body,
      notice.href,
      notice.moduleLabel,
    ],
  );
}

async function retry(job, error, db) {
  if (Number(job.attempts) >= MAX_ATTEMPTS) return finish(job, 'failed', error || 'Falabella no confirmó el cambio.', {}, db);
  const attempts = Number(job.attempts) || 0;
  const delaySeconds = attempts < 5 ? 2 : attempts < 20 ? 5 : 10;
  await db.query(
    `update marketplace_mutation_jobs set status='pending',last_error=$2,next_attempt_at=now()+($3 * interval '1 second'),updated_at=now() where id=$1`,
    [job.id, error || null, delaySeconds],
  );
}

async function submit(job, listing, adapters, db) {
  const common = { companyId: Number(listing.company_id), sellerSku: String(listing.seller_sku) };
  const response = job.kind === 'stock'
    ? await adapters.updateStock({ ...common, quantity: Number(job.target.quantity), facilityId: listingFacilityId(listing) })
    : await adapters.updateStatus({ ...common, status: job.target.visible ? 'active' : 'inactive' });
  accepted(response, job.kind === 'stock' ? 'el stock' : 'la publicación');
  await db.query(
    `update marketplace_mutation_jobs set status='pending',phase='verify',provider_request_id=$2,next_attempt_at=now()+interval '2 seconds',last_error=null,updated_at=now() where id=$1`,
    [job.id, response.requestId || null],
  );
}

async function verify(job, listing, adapters, db) {
  if (job.provider_request_id) {
    const feedResponse = await adapters.getFeedStatus({ companyId: Number(listing.company_id), feedId: job.provider_request_id });
    if (providerError(feedResponse) || feedResponse?.ok === false) return retry(job, providerError(feedResponse) || 'No se pudo consultar el feed.', db);
    if (feedFailed(feedResponse.feed)) return finish(job, 'failed', 'El feed de Falabella terminó con errores.', { feed: feedResponse.feed }, db);
    if (feedPending(feedResponse.feed)) return retry(job, null, db);
  }
  if (job.kind === 'stock') {
    const response = await adapters.getStock({ companyId: Number(listing.company_id), sellerSkus: [listing.seller_sku], limit: 1 });
    const stock = (response?.stocks || []).find((item) => sameSku(item?.sellerSku, listing.seller_sku));
    if (providerError(response) || response?.ok === false || Number(stock?.sellerWarehouseQuantity) !== Number(job.target.quantity)) {
      return retry(job, providerError(response) || null, db);
    }
    await updateListingSellerStock(listing.id, { quantity: Number(job.target.quantity), requestId: job.provider_request_id }, db);
    return finish(job, 'succeeded', `${listing.seller_sku} quedó en ${job.target.quantity} unidades.`, { stock }, db);
  }
  const response = await adapters.getProducts({ companyId: Number(listing.company_id), filters: { filter: 'all', skuSellerList: [listing.seller_sku], limit: 1 } });
  const product = (response?.products || []).find((item) => sameSku(item?.sellerSku, listing.seller_sku));
  const expected = job.target.visible ? 'active' : 'inactive';
  if (providerError(response) || response?.ok === false || falabellaPublicationState(product).businessUnitStatus !== expected) {
    return retry(job, providerError(response) || null, db);
  }
  await updateListingPublicationState(listing.id, { visible: job.target.visible, requestId: job.provider_request_id }, db);
  return finish(job, 'succeeded', `${listing.seller_sku} quedó ${job.target.visible ? 'visible' : 'oculta'}.`, { status: expected }, db);
}

export async function processMarketplaceMutationJobs({ limit = 5, adapters } = {}, db) {
  const client = await target(db);
  const core = adapters ? null : await loadCore();
  const resolved = adapters || {
    updateStock: core.falabellaUpdateStock,
    updateStatus: core.falabellaUpdateProductStatus,
    getFeedStatus: core.falabellaGetFeedStatus,
    getStock: core.falabellaGetStock,
    getProducts: core.falabellaGetProducts,
  };
  await client.query(
    `update marketplace_mutation_jobs set status='pending',next_attempt_at=now(),last_error=coalesce(last_error,'Procesamiento interrumpido.'),updated_at=now()
      where status='processing' and updated_at < now()-interval '5 minutes'`,
  );
  const claimed = await client.query(
    `update marketplace_mutation_jobs set status='processing',attempts=attempts+1,updated_at=now()
      where id in (select id from marketplace_mutation_jobs where status='pending' and (next_attempt_at is null or next_attempt_at<=now()) order by created_at limit $1 for update skip locked)
      returning *`,
    [Math.min(Math.max(Number(limit) || 5, 1), 20)],
  );
  for (const job of claimed.rows) {
    const listing = (await client.query(`select l.*,p.id as product_id from product_listings l join products p on p.id=l.product_id where l.id=$1`, [job.listing_id])).rows[0];
    const enriched = { ...job, product_id: listing?.product_id };
    try {
      if (!listing) await finish(enriched, 'failed', 'La publicación ya no existe.', {}, client);
      else if (job.phase === 'submit') await submit(enriched, listing, resolved, client);
      else await verify(enriched, listing, resolved, client);
    } catch (error) {
      await retry(enriched, String(error?.message || error).slice(0, 1000), client);
    }
  }
  return { claimed: claimed.rows.length };
}

export function startMarketplaceMutationWorker() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await processMarketplaceMutationJobs(); } catch (error) { console.error('[MARKETPLACE MUTATIONS]', error?.message || error); } finally { running = false; }
  };
  const timer = setInterval(() => { tick().catch(() => {}); }, WORKER_INTERVAL_MS);
  timer.unref?.();
  setTimeout(() => { tick().catch(() => {}); }, 500).unref?.();
  return timer;
}
