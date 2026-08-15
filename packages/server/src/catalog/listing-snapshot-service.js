import { httpError, loadCore, positiveInt } from './utils.js';

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

export function falabellaPublicationSnapshot(remote, stock, now = new Date(), { stockSource = 'falabella_get_stock' } = {}) {
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
  const availableQuantity = publication.isSellable ? reportedAvailableQuantity : 0;
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

export async function refreshFalabellaListingSnapshots(input = {}, db) {
  const core = await loadCore();
  const target = db || core.pool;
  const productId = input.productId == null ? null : positiveInt(input.productId, 'productId');
  const values = productId == null ? [] : [productId];
  const listings = (await target.query(
    `select l.id, l.product_id, l.company_id, l.seller_sku
     from product_listings l
     join products p on p.id=l.product_id
     where l.channel_code='falabella' and l.status='active' and p.status='active'
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
      const [productsResponse, stocks] = await Promise.all([
        core.falabellaGetProducts({
          companyId,
          filters: { filter: 'all', skuSellerList: sellerSkus, limit: Math.max(sellerSkus.length, 1) },
        }),
        fetchFalabellaStocks(core, companyId, sellerSkus),
      ]);
      const productsError = providerError(productsResponse);
      if (productsError || productsResponse?.ok === false) throw httpError(`GetProducts: ${productsError || 'respuesta inválida'}`, 502);
      const productsBySku = new Map((productsResponse.products || []).map((product) => [String(product.sellerSku), product]));
      const stockBySku = new Map(stocks.map((stock) => [String(stock.sellerSku), stock]));
      for (const listing of companyListings) {
        const sellerSku = String(listing.seller_sku);
        const remote = productsBySku.get(sellerSku);
        if (!remote) {
          summary.missing.push({ listingId: Number(listing.id), companyId, sellerSku, reason: 'not_returned_by_get_products' });
          continue;
        }
        const snapshot = falabellaPublicationSnapshot(remote, stockBySku.get(sellerSku));
        await target.query(
          `update product_listings set
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
