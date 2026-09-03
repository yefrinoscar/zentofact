import { createHash, randomUUID } from 'node:crypto';
import { createProduct } from './product-service.js';
import { upsertListing } from './listing-service.js';
import {
  falabellaAssociationProfile,
  groupFalabellaCatalogRecords,
  scoreFalabellaAssociation,
} from './catalog-association.js';
import { inTransaction, loadCore } from './utils.js';
import { listRipleyProducts } from '../ripley-catalog.js';

const AUTO_ASSOCIATION_THRESHOLD = 0.82;
const AMBIGUITY_MARGIN = 0.025;

function uniqueText(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function candidatePriority(score) {
  return [
    Number(score.signals.includes('seller_sku:exact')),
    Number(score.signals.includes('image:content')),
    Number(score.signals.includes('image:url')),
    Number(score.signals.some((signal) => signal.startsWith('size:'))),
    Number(score.signals.some((signal) => signal.startsWith('color:'))),
  ];
}

/** Returns a candidate only when one product wins with high, unambiguous evidence. */
export function selectRipleyProductCandidate(offer, candidates, options = {}) {
  const threshold = Number(options.threshold) || AUTO_ASSOCIATION_THRESHOLD;
  const ambiguityMargin = Number(options.ambiguityMargin) || AMBIGUITY_MARGIN;
  const ranked = candidates.map((candidate) => ({
    ...candidate,
    score: scoreFalabellaAssociation(offer, candidate.profile),
  })).filter(({ score }) => score.eligible && score.confidence >= threshold)
    .sort((left, right) => {
      const leftPriority = candidatePriority(left.score);
      const rightPriority = candidatePriority(right.score);
      for (let index = 0; index < leftPriority.length; index += 1) {
        if (leftPriority[index] !== rightPriority[index]) return rightPriority[index] - leftPriority[index];
      }
      return right.score.confidence - left.score.confidence
        || Number(left.product.id) - Number(right.product.id);
    });
  const best = ranked[0];
  if (!best) return null;
  const second = ranked[1];
  if (second) {
    const bestPriority = candidatePriority(best.score).join(':');
    const secondPriority = candidatePriority(second.score).join(':');
    if (bestPriority === secondPriority && best.score.confidence - second.score.confidence < ambiguityMargin) return null;
  }
  return {
    product: best.product,
    confidence: best.score.confidence,
    signals: best.score.signals,
  };
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

async function fingerprintImages(urls) {
  const fingerprints = new Map();
  await mapConcurrent(uniqueText(urls), 20, async (url) => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (!response.ok || !String(response.headers.get('content-type') || '').startsWith('image/')) return;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 1_024 || bytes.length > 10 * 1_024 * 1_024) return;
      fingerprints.set(url, createHash('sha256').update(bytes).digest('hex'));
    } catch {
      // La foto mejora la confianza, pero un CDN caído no debe detener el sync.
    }
  });
  return fingerprints;
}

function nextCatalogSku(products) {
  const used = new Set(products.map((product) => String(product.main_sku || '').toUpperCase()));
  let sequence = Math.max(65, ...products.map((product) => {
    const match = /^AG(\d+)$/i.exec(String(product.main_sku || ''));
    return match ? Number(match[1]) : 0;
  }));
  return () => {
    let candidate;
    do candidate = `AG${++sequence}`; while (used.has(candidate));
    used.add(candidate);
    return candidate;
  };
}

function listingImages(listing) {
  return uniqueText([
    listing.metadata?.imageUrl,
    listing.metadata?.image_url,
    listing.metadata?.fingerprintImageUrl,
  ]);
}

function productCandidate(product, fingerprints) {
  const listings = Array.isArray(product.listings) ? product.listings : [];
  const images = uniqueText([product.image_url, ...listings.flatMap(listingImages)]);
  const storedFingerprints = uniqueText(listings.flatMap((listing) => [listing.metadata?.imageFingerprint]));
  return {
    product: {
      id: Number(product.id),
      mainSku: product.main_sku,
      name: product.name,
    },
    profile: falabellaAssociationProfile({
      name: product.name,
      brand: product.brand,
      primaryCategory: product.attributes?.primary_category,
      price: product.reference_price,
      images,
      imageFingerprints: uniqueText([...storedFingerprints, ...images.map((url) => fingerprints.get(url))]),
      sellerSkus: listings.map((listing) => listing.seller_sku),
    }),
  };
}

function normalizedOffer(company, offer, fingerprints) {
  const raw = offer.raw && typeof offer.raw === 'object' && !Array.isArray(offer.raw) ? offer.raw : {};
  const images = uniqueText([offer.imageUrl]);
  return {
    company,
    offer,
    remote: {
      name: offer.productTitle || offer.sellerSku,
      sellerSku: offer.sellerSku,
      shopSku: offer.productSku,
      brand: raw.product_brand,
      primaryCategory: raw.category_label,
      price: offer.price,
      images,
      imageFingerprints: uniqueText(images.map((url) => fingerprints.get(url))),
    },
  };
}

function reportItem(record, extra = {}) {
  return {
    companyId: Number(record.company.id),
    companyName: record.company.name,
    sellerSku: record.offer.sellerSku,
    productSku: record.offer.productSku,
    title: record.offer.productTitle || record.offer.sellerSku,
    imageUrl: record.offer.imageUrl,
    ...extra,
  };
}

export function ripleyListingMetadata(offer, association) {
  const metadata = {
    imageUrl: offer.imageUrl || null,
    price: offer.price ?? null,
    isPublished: true,
    isSellable: true,
    marketplaceStatus: 'active',
  };
  if (!association) return metadata;
  return {
    ...metadata,
    associationMethod: association.method,
    associationConfidence: association.confidence,
    associationSignals: association.signals,
    catalogSyncBatchId: association.batchId,
  };
}

export function ripleyListingDeactivationPlan(successfulCompanyIds, activeOffers, existingListings) {
  const successful = new Set(successfulCompanyIds.map(Number));
  const activeIdentities = new Set(activeOffers.map(({ company, offer }) => (
    `${Number(company.id)}:${String(offer.sellerSku || '').trim()}`
  )));
  return existingListings.filter((listing) => (
    successful.has(Number(listing.company_id))
    && listing.status !== 'unlinked'
    && !activeIdentities.has(`${Number(listing.company_id)}:${String(listing.seller_sku || '').trim()}`)
  ));
}

function listingInput(record, metadata) {
  return {
    channelCode: 'ripley',
    companyId: record.company.id,
    sellerSku: record.offer.sellerSku,
    shopSku: record.offer.productSku,
    externalProductId: record.offer.productSku || record.offer.offerId,
    title: record.offer.productTitle || record.offer.sellerSku,
    marketplaceQuantity: record.offer.quantity,
    marketplaceSyncedAt: new Date().toISOString(),
    metadata,
  };
}

async function pendingImpact(db, companyId, sellerSku, productSku) {
  const result = await db.query(
    `select count(*)::int as lines, count(distinct oi.order_id)::int as orders,
       coalesce(sum(oi.quantity),0) as units
     from order_items oi join orders o on o.id=oi.order_id
     join order_channel_accounts a on a.id=o.channel_account_id
     join order_channels ch on ch.id=a.channel_id
     where oi.stock_state='skipped_unmapped' and o.company_id=$1 and ch.code='ripley'
       and (oi.sku=$2 or (nullif($3,'') is not null and oi.provider_sku=$3))`,
    [companyId, sellerSku, productSku || ''],
  );
  const row = result.rows[0] || {};
  return { lines: Number(row.lines || 0), orders: Number(row.orders || 0), units: Number(row.units || 0) };
}

/**
 * Imports active Ripley offers and associates only unambiguous matches. Offers
 * without a safe match become new master products; inactive offers are reported
 * but never auto-associated.
 */
export async function syncRipleyCatalog(input = {}, actorUserId, db) {
  const core = await loadCore();
  const target = db || core.pool;
  const companies = (input.companies || (await target.query(
    `select id, coalesce(nullif(nombre_comercial,''),nullif(nombre,''),razon_social) as name
     from companies where activo is not false and coalesce(ripley_api_key,'') <> '' order by id`,
  )).rows).map((company) => ({ id: Number(company.id), name: company.name }));
  const fetched = await mapConcurrent(companies, 3, async (company) => {
    try {
      const result = await listRipleyProducts(company.id, { all: true }, { getCompany: core.getCompany });
      return { ok: true, company, offers: result.offers || [] };
    } catch (error) {
      return { ok: false, company, error: error?.message || String(error) };
    }
  });
  const successful = fetched.filter((result) => result.ok);
  const errors = fetched.filter((result) => !result.ok).map((result) => ({
    companyId: result.company.id,
    companyName: result.company.name,
    message: result.error,
  }));
  const allOffers = successful.flatMap((result) => result.offers.map((offer) => ({ company: result.company, offer })));
  const activeOffers = allOffers.filter(({ offer }) => offer.active === true);
  const products = (await target.query(
    `select p.id,p.main_sku,p.name,p.brand,p.image_url,p.reference_price,p.attributes,
       coalesce(jsonb_agg(jsonb_build_object(
         'seller_sku',l.seller_sku,'metadata',l.metadata
       )) filter(where l.id is not null),'[]'::jsonb) as listings
     from products p left join product_listings l on l.product_id=p.id
     where p.status<>'archived' group by p.id order by p.id`,
  )).rows;
  const imageUrls = [
    ...activeOffers.map(({ offer }) => offer.imageUrl),
    ...products.flatMap((product) => [product.image_url, ...(product.listings || []).flatMap(listingImages)]),
  ];
  const fingerprints = await fingerprintImages(imageUrls);
  const candidates = products.map((product) => productCandidate(product, fingerprints));
  const existingListings = (await target.query(
    `select id,product_id,company_id,seller_sku,status from product_listings
     where channel_code='ripley'`,
  )).rows;
  const listingBySeller = new Map(existingListings.map((listing) => [
    `${Number(listing.company_id)}:${String(listing.seller_sku)}`,
    listing,
  ]));
  const listingsToDeactivate = ripleyListingDeactivationPlan(
    successful.map((result) => result.company.id),
    activeOffers,
    existingListings,
  );
  const records = activeOffers.map(({ company, offer }) => normalizedOffer(company, offer, fingerprints));
  const kept = [];
  const unlinked = [];
  const matched = [];
  const unmatched = [];
  for (const record of records) {
    const existing = listingBySeller.get(`${record.company.id}:${record.offer.sellerSku}`);
    if (existing?.status === 'active') {
      const product = candidates.find((candidate) => candidate.product.id === Number(existing.product_id))?.product;
      kept.push({ record, existing, product });
      continue;
    }
    if (existing?.status === 'unlinked') {
      unlinked.push({ record, existing });
      continue;
    }
    const selected = selectRipleyProductCandidate(record.remote, candidates);
    if (selected) matched.push({ record, selected });
    else unmatched.push(record);
  }
  const newGroups = groupFalabellaCatalogRecords(unmatched.map((record) => ({
    ...record,
    snapshot: { metadata: {} },
  })));
  const allocateSku = nextCatalogSku(products);
  const plannedGroups = newGroups.map((group) => ({ ...group, mainSku: allocateSku() }));

  const baseReport = {
    batchId: randomUUID(),
    dryRun: input.dryRun === true,
    companiesRequested: companies.length,
    companiesSynced: successful.length,
    offersReceived: allOffers.length,
    activeOffers: activeOffers.length,
    inactiveOffers: allOffers.length - activeOffers.length,
    imagesFingerprinted: fingerprints.size,
    listingsToDeactivate: listingsToDeactivate.length,
    errors,
  };
  const withImpact = async (record, extra) => ({
    ...reportItem(record, extra),
    pending: await pendingImpact(target, record.company.id, record.offer.sellerSku, record.offer.productSku),
  });
  if (input.dryRun === true) {
    const plannedCreated = (await Promise.all(plannedGroups.map((group) => Promise.all(
      group.records.map((record) => withImpact(record, {
        mainSku: group.mainSku,
        confidence: record.association?.confidence || 1,
        signals: record.association?.signals || [],
      })),
    )))).flat();
    return {
      ...baseReport,
      kept: await Promise.all(kept.map(({ record, product }) => withImpact(record, { productId: product?.id, mainSku: product?.mainSku }))),
      associated: await Promise.all(matched.map(({ record, selected }) => withImpact(record, {
        productId: selected.product.id,
        mainSku: selected.product.mainSku,
        confidence: selected.confidence,
        signals: selected.signals,
      }))),
      created: plannedCreated,
      unassociated: await Promise.all(unlinked.map(({ record }) => withImpact(record, { reason: 'manually_unlinked' }))),
    };
  }

  return inTransaction(db, async (client) => {
    const refreshed = [];
    const associated = [];
    const created = [];
    const deactivated = [];
    for (const { record, existing, product } of kept) {
      await upsertListing(Number(existing.product_id), listingInput(record, ripleyListingMetadata(record.offer)), client);
      refreshed.push(await withImpact(record, {
        productId: Number(existing.product_id),
        mainSku: product?.mainSku,
      }));
    }
    for (const { record, selected } of matched) {
      await upsertListing(selected.product.id, listingInput(record, ripleyListingMetadata(record.offer, {
        batchId: baseReport.batchId,
        method: 'multisignal_v1',
        confidence: selected.confidence,
        signals: selected.signals,
      })), client);
      associated.push(await withImpact(record, {
        productId: selected.product.id,
        mainSku: selected.product.mainSku,
        confidence: selected.confidence,
        signals: selected.signals,
      }));
    }
    for (const group of plannedGroups) {
      const first = group.records[0];
      const product = await createProduct({
        mainSku: group.mainSku,
        name: first.offer.productTitle || first.offer.sellerSku,
        brand: first.remote.brand || null,
        imageUrl: first.offer.imageUrl || null,
        referencePrice: first.offer.price,
        attributes: {
          imported_from: 'ripley',
          ripley_identity_key: group.identity,
          ripley_association_method: 'multisignal_v1',
          primary_category: first.remote.primaryCategory || null,
          catalog_sync_batch_id: baseReport.batchId,
        },
      }, actorUserId, client);
      for (const record of group.records) {
        await upsertListing(product.id, listingInput(record, ripleyListingMetadata(record.offer, {
          batchId: baseReport.batchId,
          method: record.association?.method || 'new_product',
          confidence: record.association?.confidence || 1,
          signals: record.association?.signals || [],
        })), client);
        created.push(await withImpact(record, {
          productId: product.id,
          mainSku: product.mainSku,
          confidence: record.association?.confidence || 1,
          signals: record.association?.signals || [],
        }));
      }
    }
    for (const listing of listingsToDeactivate) {
      const result = await client.query(
        `update product_listings set
           status='inactive',marketplace_quantity=0,marketplace_synced_at=now(),
           metadata=coalesce(metadata,'{}'::jsonb) || $1::jsonb,updated_at=now()
         where id=$2 and status <> 'unlinked'
         returning id,product_id,company_id,seller_sku`,
        [JSON.stringify({
          isPublished: false,
          isSellable: false,
          marketplaceStatus: 'inactive',
          sellabilityReason: 'not_returned_by_ripley_catalog',
          catalogSyncBatchId: baseReport.batchId,
        }), listing.id],
      );
      if (result.rows[0]) deactivated.push({
        listingId: Number(result.rows[0].id),
        productId: Number(result.rows[0].product_id),
        companyId: Number(result.rows[0].company_id),
        sellerSku: result.rows[0].seller_sku,
      });
    }
    return {
      ...baseReport,
      kept: refreshed,
      associated,
      created,
      deactivated,
      unassociated: await Promise.all(unlinked.map(({ record }) => withImpact(record, { reason: 'manually_unlinked' }))),
    };
  });
}
