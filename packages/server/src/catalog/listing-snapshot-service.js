import { httpError, loadCore, positiveInt } from './utils.js';
import { listRipleyProducts } from '../ripley-catalog.js';

function providerError(response) {
  return response?.error?.Head?.ErrorMessage
    || response?.error?.message
    || (typeof response?.error === 'string' ? response.error : null);
}

function numberOrNull(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedStatus(value) {
  return String(value ?? '').trim().toLowerCase();
}

function booleanOrNull(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return null;
  if (['1', 'true', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'no'].includes(normalized)) return false;
  return null;
}

export function falabellaPublicationState(remote = {}) {
  const units = Array.isArray(remote?.businessUnits) ? remote.businessUnits : [];
  const unit = units.find((candidate) => String(candidate?.operatorCode || '').toLowerCase() === 'fape')
    || units[0]
    || null;
  const productStatus = normalizedStatus(remote?.status);
  const businessUnitStatus = normalizedStatus(unit?.status);
  const qcStatus = normalizedStatus(remote?.qcStatus);
  const isPublished = booleanOrNull(unit?.isPublished);
  const sellabilityReasons = [];
  if (productStatus && productStatus !== 'active') sellabilityReasons.push('product_not_active');
  if (businessUnitStatus && businessUnitStatus !== 'active') sellabilityReasons.push('business_unit_not_active');
  if (qcStatus && qcStatus !== 'approved') sellabilityReasons.push('qc_not_approved');
  if (isPublished === false) sellabilityReasons.push('not_published');
  return {
    hasBusinessUnit: Boolean(unit),
    productStatus: productStatus || null,
    businessUnitStatus: businessUnitStatus || null,
    qcStatus: qcStatus || null,
    isPublished,
    isSellable: sellabilityReasons.length === 0,
    sellabilityReason: sellabilityReasons[0] || null,
    sellabilityReasons,
    unit: unit || {},
  };
}

function dateIsActive(fromValue, toValue, now = new Date()) {
  const parse = (value) => {
    if (!value) return null;
    const parsed = new Date(String(value).replace(' ', 'T'));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const from = parse(fromValue);
  const to = parse(toValue);
  return (!from || from <= now) && (!to || now <= to);
}

export async function fetchFalabellaStocks(core, companyId, sellerSkus = []) {
  const normalizedSkus = [...new Set(sellerSkus.map((sku) => String(sku || '').trim()).filter(Boolean))];
  const stocks = [];
  for (let offset = 0; offset < normalizedSkus.length; offset += 1000) {
    const batch = normalizedSkus.slice(offset, offset + 1000);
    const response = await core.falabellaGetStock({ companyId, sellerSkus: batch, limit: batch.length });
    const error = providerError(response);
    if (error || response?.ok === false) {
      throw httpError(`GetStock: ${error || 'respuesta inválida'}`, 502);
    }
    stocks.push(...(response?.stocks || []));
  }
  return stocks;
}

const FALABELLA_PRODUCT_SKU_BATCH = 100;
const FALABELLA_PUBLIC_AVAILABILITY_CONCURRENCY = 10;
const FALABELLA_PUBLIC_REQUEST_TIMEOUT_MS = 8_000;

function parseFalabellaProductUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.falabella.com.pe')) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const productIndex = parts.indexOf('product');
    if (productIndex < 1) return null;
    const site = parts[productIndex - 1];
    const productId = parts[productIndex + 1];
    const productName = parts[productIndex + 2];
    const variantId = parts[productIndex + 3];
    if (!site || !productId || !productName || !variantId) return null;
    return { origin: url.origin, site, productId, productName, variantId, pageUrl: url.toString() };
  } catch {
    return null;
  }
}

function publicAvailabilityFromProductData(productData, checkedAt) {
  const isPublished = typeof productData?.isPublished === 'boolean' ? productData.isPublished : null;
  const isOutOfStock = typeof productData?.isOutOfStock === 'boolean' ? productData.isOutOfStock : null;
  const unavailable = isPublished === false || isOutOfStock === true;
  const available = isPublished === true && isOutOfStock === false;
  return {
    status: unavailable ? 'unavailable' : available ? 'available' : 'unknown',
    checkedAt,
    isPublished,
    isOutOfStock,
  };
}

function parseNextDataDocument(document) {
  const match = String(document || '').match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function falabellaNextDataUrl(product, buildId) {
  const url = new URL(`/_next/data/${encodeURIComponent(buildId)}/product.json`, product.origin);
  url.searchParams.set('site', product.site);
  url.searchParams.set('productId', product.productId);
  url.searchParams.set('productName', product.productName);
  url.searchParams.set('variantId', product.variantId);
  return url.toString();
}

async function mapConcurrent(items, concurrency, worker) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  }));
}

export async function fetchFalabellaPublicAvailabilities(remotes, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const concurrency = Math.min(
    Math.max(Number(options.concurrency) || FALABELLA_PUBLIC_AVAILABILITY_CONCURRENCY, 1),
    20,
  );
  const timeoutMs = Number(options.timeoutMs) || FALABELLA_PUBLIC_REQUEST_TIMEOUT_MS;
  const checkedAt = (options.now || new Date()).toISOString();
  const candidates = remotes.map((remote) => ({
    sellerSku: String(remote?.sellerSku || '').trim(),
    product: parseFalabellaProductUrl(remote?.url),
  })).filter(({ sellerSku, product }) => sellerSku && product);
  const availabilityBySku = new Map();
  if (!candidates.length) return availabilityBySku;

  let buildId = null;
  let bootstrapCandidate = null;
  for (const candidate of candidates) {
    try {
      const response = await fetchImpl(candidate.product.pageUrl, {
        headers: { accept: 'text/html', 'user-agent': 'ZentoFact catalog availability sync' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) continue;
      const nextData = parseNextDataDocument(await response.text());
      if (!nextData?.buildId) continue;
      buildId = String(nextData.buildId);
      bootstrapCandidate = candidate;
      availabilityBySku.set(candidate.sellerSku, publicAvailabilityFromProductData(
        nextData?.props?.pageProps?.productData,
        checkedAt,
      ));
      break;
    } catch {
      // La tienda pública es una segunda fuente. Si no responde, conservamos
      // el stock de Seller Center en vez de convertir una falla de red en cero.
    }
  }
  if (!buildId) return availabilityBySku;

  const remaining = candidates.filter((candidate) => candidate !== bootstrapCandidate);
  await mapConcurrent(remaining, concurrency, async (candidate) => {
    try {
      const response = await fetchImpl(falabellaNextDataUrl(candidate.product, buildId), {
        headers: { accept: 'application/json', 'user-agent': 'ZentoFact catalog availability sync' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return;
      const nextData = JSON.parse(await response.text());
      availabilityBySku.set(candidate.sellerSku, publicAvailabilityFromProductData(
        nextData?.pageProps?.productData,
        checkedAt,
      ));
    } catch {
      // Un producto que no respondió queda con el valor de Seller Center.
    }
  });
  return availabilityBySku;
}

export async function fetchFalabellaProductsBySku(core, companyId, sellerSkus = []) {
  const normalizedSkus = [...new Set(sellerSkus.map((sku) => String(sku || '').trim()).filter(Boolean))];
  const products = [];
  for (let offset = 0; offset < normalizedSkus.length; offset += FALABELLA_PRODUCT_SKU_BATCH) {
    const batch = normalizedSkus.slice(offset, offset + FALABELLA_PRODUCT_SKU_BATCH);
    const response = await core.falabellaGetProducts({
      companyId,
      filters: { filter: 'all', skuSellerList: batch, limit: Math.max(batch.length, 1) },
    });
    const error = providerError(response);
    if (error || response?.ok === false) {
      throw httpError(`GetProducts: ${error || 'respuesta inválida'}`, 502);
    }
    products.push(...(response?.products || []));
  }
  return products;
}

export function falabellaPublicationSnapshot(remote, stock, now = new Date(), {
  stockSource = 'falabella_get_stock',
  publicAvailability,
} = {}) {
  const publication = falabellaPublicationState(remote);
  const unit = publication.unit;
  const regularPrice = numberOrNull(unit.price ?? remote?.price);
  const offerPrice = numberOrNull(unit.specialPrice ?? remote?.salePrice);
  const specialFromDate = unit.specialFromDate ?? unit.raw?.SpecialFromDate ?? null;
  const specialToDate = unit.specialToDate ?? unit.raw?.SpecialToDate ?? null;
  const offerIsActive = offerPrice != null && dateIsActive(specialFromDate, specialToDate, now);
  const effectivePrice = offerIsActive ? offerPrice : regularPrice;
  const sellerWarehouseQuantity = numberOrNull(stock?.sellerWarehouseQuantity) ?? 0;
  const fulfillmentQuantity = numberOrNull(stock?.fulfillmentQuantity) ?? 0;
  const reportedAvailableQuantity = numberOrNull(stock?.availableQuantity)
    ?? sellerWarehouseQuantity + fulfillmentQuantity;
  const publicAvailabilityStatus = publicAvailability?.status;
  const availableQuantity = publicAvailabilityStatus === 'unavailable'
    ? 0
    : reportedAvailableQuantity;
  return {
    title: remote?.name || null,
    shopSku: remote?.shopSku || null,
    externalProductId: remote?.productId || null,
    availableQuantity,
    metadata: {
      price: effectivePrice,
      effectivePrice,
      regularPrice,
      offerPrice,
      offerIsActive,
      specialFromDate,
      specialToDate,
      priceSource: 'falabella_get_products',
      stockSource,
      sellerWarehouseQuantity,
      fulfillmentQuantity,
      reportedAvailableQuantity,
      publicAvailabilityStatus,
      publicAvailabilityCheckedAt: publicAvailability?.checkedAt,
      publicIsPublished: publicAvailability?.isPublished,
      publicIsOutOfStock: publicAvailability?.isOutOfStock,
      isSellable: publication.isSellable,
      sellabilityReason: publication.sellabilityReason,
      sellabilityReasons: publication.sellabilityReasons,
      productStatus: publication.productStatus,
      businessUnitStatus: publication.businessUnitStatus,
      contentScore: numberOrNull(remote?.contentScore),
      sellerWarehouses: stock?.sellerWarehouses || [],
      fulfillmentWarehouses: stock?.fulfillmentWarehouses || [],
      status: remote?.status || null,
      qcStatus: publication.qcStatus,
      marketplaceStatus: unit.status || remote?.status || null,
      isPublished: publication.isPublished,
      url: remote?.url || null,
      color: remote?.color || null,
      size: remote?.size || null,
      brand: remote?.brand || null,
      primaryCategory: remote?.primaryCategory || null,
      images: Array.isArray(remote?.images) ? remote.images : [],
    },
  };
}

export async function refreshFalabellaListingSnapshots(input = {}, db, dependencies = {}) {
  const core = dependencies.core || await loadCore();
  const target = db || core.pool;
  const productId = input.productId == null ? null : positiveInt(input.productId, 'productId');
  const values = productId == null ? [] : [productId];
  const listings = (await target.query(
    `select l.id, l.product_id, l.company_id, l.seller_sku
     from product_listings l
     join products p on p.id=l.product_id
     where l.channel_code='falabella' and l.status <> 'unlinked' and p.status<>'archived'
       ${productId == null ? '' : 'and l.product_id=$1'}
     order by l.company_id, l.id`,
    values,
  )).rows;
  const groups = new Map();
  for (const listing of listings) {
    const companyId = Number(listing.company_id);
    if (!groups.has(companyId)) groups.set(companyId, []);
    groups.get(companyId).push(listing);
  }

  const summary = { requested: listings.length, refreshed: 0, missing: [], errors: [] };
  for (const [companyId, companyListings] of groups) {
    const sellerSkus = companyListings.map((listing) => listing.seller_sku);
    try {
      const products = await fetchFalabellaProductsBySku(core, companyId, sellerSkus);
      const returnedSellerSkus = [...new Set(products
        .map((product) => String(product?.sellerSku || '').trim())
        .filter(Boolean))];
      const stocks = returnedSellerSkus.length
        ? await fetchFalabellaStocks(core, companyId, returnedSellerSkus)
        : [];
      const fetchPublicAvailabilities = dependencies.fetchPublicAvailabilities
        || fetchFalabellaPublicAvailabilities;
      const publicAvailabilityBySku = await fetchPublicAvailabilities(products);
      const productsBySku = new Map(products.map((product) => [String(product.sellerSku), product]));
      const stockBySku = new Map(stocks.map((stock) => [String(stock.sellerSku), stock]));
      for (const listing of companyListings) {
        const sellerSku = String(listing.seller_sku);
        const remote = productsBySku.get(sellerSku);
        if (!remote) {
          summary.missing.push({ listingId: Number(listing.id), companyId, sellerSku, reason: 'not_returned_by_get_products' });
          await target.query(
            `update product_listings set
               status='inactive', marketplace_quantity=0, marketplace_synced_at=now(),
               metadata=coalesce(metadata, '{}'::jsonb) || $1::jsonb,
               updated_at=now()
             where id=$2`,
            [JSON.stringify({
              isPublished: false,
              isSellable: false,
              marketplaceStatus: 'inactive',
              sellabilityReason: 'not_returned_by_falabella_catalog',
            }), listing.id],
          );
          summary.refreshed += 1;
          continue;
        }
        const snapshot = falabellaPublicationSnapshot(
          remote,
          stockBySku.get(sellerSku),
          new Date(),
          { publicAvailability: publicAvailabilityBySku.get(sellerSku) },
        );
        await target.query(
          `update product_listings set
             status='active',
             shop_sku=coalesce($1, shop_sku),
             external_product_id=coalesce($2, external_product_id),
             title=coalesce($3, title),
             marketplace_quantity=$4,
             marketplace_synced_at=now(),
             metadata=coalesce(metadata, '{}'::jsonb) || $5::jsonb,
             updated_at=now()
           where id=$6`,
          [
            snapshot.shopSku,
            snapshot.externalProductId,
            snapshot.title,
            snapshot.availableQuantity,
            JSON.stringify(snapshot.metadata),
            listing.id,
          ],
        );
        summary.refreshed += 1;
      }
    } catch (error) {
      summary.errors.push({ companyId, message: error?.message || String(error) });
    }
  }
  return summary;
}

export async function refreshRipleyListingSnapshots(input = {}, db, dependencies = {}) {
  const core = dependencies.core || await loadCore();
  const target = db || core.pool;
  const productId = input.productId == null ? null : positiveInt(input.productId, 'productId');
  const values = productId == null ? [] : [productId];
  const listings = (await target.query(
    `select l.id,l.product_id,l.company_id,l.seller_sku
     from product_listings l join products p on p.id=l.product_id
     where l.channel_code='ripley' and l.status <> 'unlinked' and p.status<>'archived'
       ${productId == null ? '' : 'and l.product_id=$1'}
     order by l.company_id,l.id`,
    values,
  )).rows;
  const groups = new Map();
  for (const listing of listings) {
    const companyId = Number(listing.company_id);
    const current = groups.get(companyId) || [];
    current.push(listing);
    groups.set(companyId, current);
  }
  const summary = { requested: listings.length, refreshed: 0, missing: [], errors: [] };
  const fetchProducts = dependencies.listRipleyProducts || ((companyId) => listRipleyProducts(
    companyId,
    { all: true },
    { getCompany: core.getCompany },
  ));
  for (const [companyId, companyListings] of groups) {
    try {
      const response = await fetchProducts(companyId);
      const offers = Array.isArray(response?.offers) ? response.offers : [];
      const offersBySku = new Map(offers.map((offer) => [String(offer.sellerSku || '').trim(), offer]));
      for (const listing of companyListings) {
        const offer = offersBySku.get(String(listing.seller_sku || '').trim());
        const active = offer?.active === true;
        const metadata = offer ? {
          price: offer.price ?? null,
          imageUrl: offer.imageUrl || null,
          isPublished: active,
          isSellable: active,
          marketplaceStatus: active ? 'active' : 'inactive',
          sellabilityReason: active ? null : 'ripley_offer_inactive',
        } : {
          isPublished: false,
          isSellable: false,
          marketplaceStatus: 'inactive',
          sellabilityReason: 'not_returned_by_ripley_catalog',
        };
        await target.query(
          `update product_listings set
             shop_sku=coalesce($1,shop_sku),
             external_product_id=coalesce($2,external_product_id),
             title=coalesce($3,title),status=$4,marketplace_quantity=$5,
             marketplace_synced_at=now(),metadata=coalesce(metadata,'{}'::jsonb) || $6::jsonb,
             updated_at=now()
           where id=$7`,
          [
            offer?.productSku || null,
            offer?.productSku || offer?.offerId || null,
            offer?.productTitle || null,
            active ? 'active' : 'inactive',
            active ? Number(offer.quantity || 0) : 0,
            JSON.stringify(metadata),
            listing.id,
          ],
        );
        if (!offer) summary.missing.push({
          listingId: Number(listing.id), companyId, sellerSku: listing.seller_sku,
          reason: 'not_returned_by_ripley_catalog',
        });
        summary.refreshed += 1;
      }
    } catch (error) {
      summary.errors.push({ companyId, message: error?.message || String(error) });
    }
  }
  return summary;
}

export async function refreshMarketplaceListingSnapshots(input = {}, db, dependencies = {}) {
  const [falabella, ripley] = await Promise.all([
    refreshFalabellaListingSnapshots(input, db, dependencies.falabella || dependencies),
    refreshRipleyListingSnapshots(input, db, dependencies.ripley || dependencies),
  ]);
  return {
    requested: falabella.requested + ripley.requested,
    refreshed: falabella.refreshed + ripley.refreshed,
    missing: [...falabella.missing, ...ripley.missing],
    errors: [...falabella.errors, ...ripley.errors],
    channels: { falabella, ripley },
  };
}
