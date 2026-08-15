import { createHash, randomUUID } from 'node:crypto';
import { createProduct } from './product-service.js';
import { upsertListing } from './listing-service.js';
import { falabellaPublicationSnapshot } from './listing-snapshot-service.js';
import { falabellaAssociationProfile, groupFalabellaCatalogRecords } from './catalog-association.js';
import { httpError, inTransaction, loadCore, positiveInt } from './utils.js';

export function sanitizeMainSku(value, fallback = '') {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 64)
    .replace(/-+$/g, '');
  if (normalized) return normalized;
  const digest = createHash('sha1').update(String(fallback || randomUUID())).digest('hex').slice(0, 10).toUpperCase();
  return `FAL-${digest}`;
}

async function fetchFalabellaCatalog(core, companyId, maxItems = null) {
  const products = [];
  const requestedMax = maxItems == null ? null : Math.min(Math.max(Number(maxItems) || 0, 1), 1000);
  const limit = requestedMax || 1000;
  for (let offset = 0; offset < 20000; offset += limit) {
    const response = await core.falabellaGetProducts({
      companyId,
      filters: { filter: 'all', limit, offset, includeTotal: offset === 0 },
    });
    if (response?.error || response?.ok === false) {
      const providerMessage = response?.error?.Head?.ErrorMessage || response?.error?.message || response?.error;
      throw httpError(`Falabella no pudo entregar el catálogo: ${providerMessage || 'error desconocido'}`, 502);
    }
    const page = Array.isArray(response?.products) ? response.products : [];
    products.push(...page.slice(0, requestedMax ? requestedMax - products.length : page.length));
    if (requestedMax && products.length >= requestedMax) break;
    if (page.length < limit || (response.totalCount != null && products.length >= Number(response.totalCount))) break;
  }
  return products;
}

function normalizedIdentityPart(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function falabellaUnit(remote) {
  const units = Array.isArray(remote?.businessUnits) ? remote.businessUnits : [];
  return units.find((unit) => String(unit?.operatorCode || '').toLowerCase() === 'fape') || units[0] || null;
}

export function isFalabellaActivePublished(remote) {
  const unit = falabellaUnit(remote);
  if (!unit) return false;
  return String(remote?.status || '').trim().toLowerCase() === 'active'
    && String(unit.status || '').trim().toLowerCase() === 'active'
    && String(unit.isPublished || '').trim() === '1'
    && String(remote?.qcStatus || '').trim().toLowerCase() === 'approved';
}

export function falabellaCanonicalIdentity(remote) {
  const profile = falabellaAssociationProfile(remote);
  return [profile.normalizedTitle, profile.color, profile.size].join('|');
}

function canonicalDisplayName(records) {
  const first = records[0]?.remote || {};
  const name = String(first.name || first.sellerSku || 'Producto').trim();
  const profile = falabellaAssociationProfile(first);
  const variation = [first.color || profile.color, first.size || profile.size]
    .map((value) => String(value || '').trim()).filter(Boolean);
  if (!variation.length) return name;
  const normalizedName = ` ${normalizedIdentityPart(name)} `;
  const missing = variation.filter((value) => !normalizedName.includes(` ${normalizedIdentityPart(value)} `));
  return missing.length ? `${name} · ${missing.join(' · ')}` : name;
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

function isShortInternalSku(value) {
  return /^[A-Z]{2}\d{1,6}$/.test(String(value || '').trim());
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

async function attachPrimaryImageFingerprints(records) {
  const urls = [...new Set(records.map(({ remote }) => remote?.images?.[0]).filter(Boolean))];
  const fingerprintByUrl = new Map();
  await mapConcurrent(urls, 20, async (url) => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok || !String(response.headers.get('content-type') || '').startsWith('image/')) return;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 1024 || bytes.length > 10 * 1024 * 1024) return;
      fingerprintByUrl.set(url, createHash('sha256').update(bytes).digest('hex'));
    } catch {
      // La imagen es una señal adicional: un fallo no debe tumbar el sync del catálogo.
    }
  });
  for (const record of records) {
    const imageUrl = record.remote?.images?.[0];
    const fingerprint = fingerprintByUrl.get(imageUrl);
    if (!fingerprint) continue;
    record.remote.imageFingerprints = [fingerprint];
    record.snapshot.metadata.imageFingerprint = fingerprint;
    record.snapshot.metadata.fingerprintImageUrl = imageUrl;
  }
  return fingerprintByUrl.size;
}

async function fetchCompanyCatalog(core, company) {
  const products = await fetchFalabellaCatalog(core, Number(company.id));
  const activeProducts = products.filter(isFalabellaActivePublished);
  const sellerSkus = activeProducts.map((product) => String(product.sellerSku || '').trim()).filter(Boolean);
  const stockResponse = sellerSkus.length
    ? await core.falabellaGetStock({ companyId: Number(company.id), sellerSkus, limit: sellerSkus.length })
    : { stocks: [] };
  if (stockResponse?.error || stockResponse?.ok === false) {
    const message = stockResponse?.error?.Head?.ErrorMessage || stockResponse?.error?.message || stockResponse?.error;
    throw httpError(`Falabella no pudo entregar el stock: ${message || 'error desconocido'}`, 502);
  }
  const stockBySku = new Map((stockResponse.stocks || []).map((stock) => [String(stock.sellerSku), stock]));
  return {
    company,
    received: products.length,
    records: activeProducts.map((remote) => ({
      company,
      remote,
      identity: falabellaCanonicalIdentity(remote),
      snapshot: falabellaPublicationSnapshot(remote, stockBySku.get(String(remote.sellerSku))),
    })),
  };
}

/**
 * Descubre y reconcilia el catálogo completo de Falabella sin escribir en el seller.
 * Solo conserva listings que la API reporta activos, publicados y aprobados por QC.
 */
export async function syncAllFalabellaCatalog(input = {}, actorUserId, db) {
  const core = await loadCore();
  const target = db || core.pool;
  const companies = (input.companies || (await target.query(
    `select id, coalesce(nullif(nombre_comercial, ''), nullif(nombre, ''), razon_social) as name
     from companies
     where activo is not false
       and coalesce(falabella_api_user_id, '') <> ''
       and coalesce(falabella_api_key, '') <> ''
     order by id`,
  )).rows).map((company) => ({ ...company, id: Number(company.id) }));

  const fetchResults = await mapConcurrent(companies, Math.min(Math.max(Number(input.concurrency) || 3, 1), 5), async (company) => {
    try {
      return { ok: true, ...(await fetchCompanyCatalog(core, company)) };
    } catch (error) {
      return { ok: false, company, error: error?.message || String(error) };
    }
  });
  const successful = fetchResults.filter((result) => result.ok);
  const errors = fetchResults.filter((result) => !result.ok).map((result) => ({
    companyId: result.company.id,
    companyName: result.company.name,
    message: result.error,
  }));
  if (!successful.length) throw httpError('Ningún seller respondió con un catálogo válido.', 502);
  const records = successful.flatMap((result) => result.records);
  const imagesFingerprinted = await attachPrimaryImageFingerprints(records);

  return inTransaction(db, async (client) => {
    const batchId = randomUUID();
    const existingProducts = (await client.query(
      `select id, main_sku, name, status, attributes from products order by status='active' desc, id`,
    )).rows;
    const existingListings = (await client.query(
      `select id, product_id, company_id, seller_sku, title, status, metadata
       from product_listings where channel_code='falabella' order by id`,
    )).rows;
    const productById = new Map(existingProducts.map((product) => [Number(product.id), product]));
    const productByListing = new Map(existingListings.map((listing) => [
      `${Number(listing.company_id)}:${String(listing.seller_sku)}`,
      productById.get(Number(listing.product_id)),
    ]));
    const productByIdentity = new Map();
    for (const product of existingProducts) {
      const identity = String(product.attributes?.falabella_identity_key || '').trim();
      if (identity && !productByIdentity.has(identity)) productByIdentity.set(identity, product);
    }
    for (const listing of existingListings) {
      const identity = falabellaCanonicalIdentity({
        name: listing.title,
        color: listing.metadata?.color,
        size: listing.metadata?.size,
      });
      const product = productById.get(Number(listing.product_id));
      if (identity && product && !productByIdentity.has(identity)) productByIdentity.set(identity, product);
    }

    const grouped = groupFalabellaCatalogRecords(records);
    const allocateSku = nextCatalogSku(existingProducts);
    let productsCreated = 0;
    let productsReused = 0;
    let listingsUpserted = 0;
    let listingsDeactivated = 0;
    let multisignalAssociations = 0;
    const assignedProductIds = new Set();

    for (const cluster of grouped) {
      const { identity, records: group } = cluster;
      const productFrequency = new Map();
      for (const record of group) {
        const candidate = productByListing.get(`${record.company.id}:${record.remote.sellerSku}`);
        if (!candidate) continue;
        const entry = productFrequency.get(Number(candidate.id)) || { product: candidate, count: 0 };
        entry.count += 1;
        productFrequency.set(Number(candidate.id), entry);
      }
      let product = [...productFrequency.values()].filter(({ product: candidate }) => (
        !assignedProductIds.has(Number(candidate.id))
      )).sort((left, right) => (
        right.count - left.count
        || Number(right.product.status === 'active') - Number(left.product.status === 'active')
        || Number(left.product.id) - Number(right.product.id)
      ))[0]?.product;
      const identityProduct = productByIdentity.get(identity);
      if (!product && identityProduct && !assignedProductIds.has(Number(identityProduct.id))) product = identityProduct;
      if (!product) {
        const first = group[0];
        const price = first.snapshot.metadata.effectivePrice ?? first.snapshot.metadata.regularPrice;
        const created = await createProduct({
          mainSku: allocateSku(),
          name: canonicalDisplayName(group),
          brand: first.remote.brand || null,
          imageUrl: first.remote.images?.[0] || null,
          referencePrice: price ?? null,
          attributes: {
            imported_from: 'falabella',
            falabella_identity_key: identity,
            falabella_association_method: 'multisignal_v1',
            original_title: first.remote.name || null,
            primary_category: first.remote.primaryCategory || null,
            color: first.remote.color || null,
            size: first.remote.size || null,
            catalog_sync_batch_id: batchId,
          },
        }, actorUserId, client);
        product = { id: created.id, main_sku: created.mainSku, status: created.status, attributes: created.attributes };
        productById.set(Number(product.id), product);
        productByIdentity.set(identity, product);
        productsCreated += 1;
      } else {
        productsReused += 1;
        const importedFromFalabella = product.attributes?.imported_from === 'falabella';
        const displayName = importedFromFalabella ? canonicalDisplayName(group) : null;
        const replacementSku = importedFromFalabella && !isShortInternalSku(product.main_sku)
          ? allocateSku()
          : null;
        await client.query(
          `update products set status='active', main_sku=coalesce($1, main_sku), name=coalesce($2, name),
             attributes=coalesce(attributes, '{}'::jsonb) || $3::jsonb,
             updated_at=now(), updated_by=$4
           where id=$5`,
          [
            replacementSku,
            displayName,
            JSON.stringify({
              falabella_identity_key: identity,
              falabella_association_method: 'multisignal_v1',
              catalog_sync_batch_id: batchId,
            }),
            actorUserId ? String(actorUserId) : null,
            product.id,
          ],
        );
        if (replacementSku) product.main_sku = replacementSku;
      }
      assignedProductIds.add(Number(product.id));
      for (const record of group) {
        if (record.association?.method === 'multisignal') multisignalAssociations += 1;
        await upsertListing(product.id, {
          channelCode: 'falabella',
          companyId: record.company.id,
          sellerSku: record.remote.sellerSku,
          shopSku: record.snapshot.shopSku,
          externalProductId: record.snapshot.externalProductId,
          title: record.snapshot.title,
          marketplaceQuantity: record.snapshot.availableQuantity,
          marketplaceSyncedAt: new Date().toISOString(),
          metadata: {
            ...record.snapshot.metadata,
            sourceCompanyId: record.company.id,
            sourceCompanyName: record.company.name,
            catalogIdentityKey: identity,
            associationMethod: record.association?.method || 'exact',
            associationConfidence: record.association?.confidence ?? 1,
            associationSignals: record.association?.signals || [],
            catalogSyncBatchId: batchId,
          },
        }, client);
        listingsUpserted += 1;
      }
    }

    for (const result of successful) {
      const activeSkus = result.records.map((record) => String(record.remote.sellerSku));
      const deactivated = await client.query(
        `update product_listings set status='inactive', updated_at=now()
         where channel_code='falabella' and company_id=$1 and status='active'
           and not (seller_sku = any($2::text[]))
         returning id`,
        [result.company.id, activeSkus],
      );
      listingsDeactivated += deactivated.rows.length;
    }

    await client.query(
      `update products p set status='inactive', updated_at=now(), updated_by=$1
       where p.status='active'
         and (p.attributes->>'imported_from'='falabella' or p.attributes->>'source'='falabella_real_catalog')
         and not exists (
           select 1 from product_listings l where l.product_id=p.id and l.status='active'
         )`,
      [actorUserId ? String(actorUserId) : null],
    );

    return {
      batchId,
      companiesRequested: companies.length,
      companiesSynced: successful.length,
      publicationsReceived: successful.reduce((total, result) => total + result.received, 0),
      activePublishedListings: records.length,
      canonicalProducts: grouped.length,
      multisignalAssociations,
      imagesFingerprinted,
      productsCreated,
      productsReused,
      listingsUpserted,
      listingsDeactivated,
      sellers: successful.map((result) => ({
        companyId: result.company.id,
        companyName: result.company.name,
        received: result.received,
        activePublished: result.records.length,
      })),
      errors,
    };
  });
}

export async function importFalabellaCatalog(input, actorUserId, db) {
  const companyId = positiveInt(input.companyId, 'companyId');
  const mode = String(input.mode || 'listings_only');
  if (!['listings_only', 'create_products_from_seller_sku'].includes(mode)) throw httpError('mode inválido.');
  const remoteProducts = input.products || await fetchFalabellaCatalog(await loadCore(), companyId, input.limit);

  return inTransaction(db, async (client) => {
    const summary = { batchId: randomUUID(), received: remoteProducts.length, productsCreated: 0, productsReused: 0, listingsUpserted: 0, skipped: [] };
    for (const remote of remoteProducts) {
      const sellerSku = String(remote.sellerSku || '').trim();
      if (!sellerSku) {
        summary.skipped.push({ reason: 'missing_seller_sku', name: remote.name || null });
        continue;
      }
      const mainSku = sanitizeMainSku(sellerSku, remote.productId || remote.name);
      let productRow = (await client.query(
        `select p.id, p.main_sku from product_listings l
         join products p on p.id=l.product_id
         where l.channel_code='falabella' and l.company_id=$1 and l.seller_sku=$2
         limit 1`,
        [companyId, sellerSku],
      )).rows[0];
      productRow ||= (await client.query('select id, main_sku from products where main_sku=$1', [mainSku])).rows[0];
      if (!productRow) {
        if (mode === 'listings_only') {
          summary.skipped.push({ sellerSku, mainSku, reason: 'product_not_found' });
          continue;
        }
        const providerPrice = [remote.salePrice, remote.price]
          .find((value) => value != null && String(value).trim() !== '');
        const created = await createProduct({
          mainSku,
          name: remote.name || sellerSku,
          brand: remote.brand || null,
          imageUrl: remote.images?.[0] || null,
          referencePrice: providerPrice ?? null,
          attributes: {
            original_seller_sku: sellerSku,
            primary_category: remote.primaryCategory || null,
            imported_from: 'falabella',
          },
        }, actorUserId, client);
        productRow = { id: created.id, main_sku: created.mainSku };
        summary.productsCreated += 1;
      } else {
        if (input.forceNew === true) {
          throw httpError(`El mainSku ${mainSku} ya existe. Indica un mainSku diferente para forzar un producto nuevo.`, 409, 'duplicate_main_sku');
        }
        summary.productsReused += 1;
      }
      const publicationSnapshot = falabellaPublicationSnapshot(remote);
      await upsertListing(productRow.id, {
        channelCode: 'falabella',
        companyId,
        sellerSku,
        shopSku: remote.shopSku || null,
        externalProductId: remote.productId || null,
        title: remote.name || sellerSku,
        marketplaceQuantity: remote.quantity ?? remote.businessUnits?.[0]?.stock ?? null,
        marketplaceSyncedAt: new Date().toISOString(),
        metadata: {
          status: publicationSnapshot.metadata.status,
          marketplaceStatus: publicationSnapshot.metadata.marketplaceStatus,
          qcStatus: publicationSnapshot.metadata.qcStatus,
          isPublished: publicationSnapshot.metadata.isPublished,
          url: remote.url || null,
          importBatchId: summary.batchId,
        },
      }, client);
      summary.listingsUpserted += 1;
    }
    return summary;
  });
}
