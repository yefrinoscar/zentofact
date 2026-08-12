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

export function falabellaPublicationSnapshot(remote, stock, now = new Date()) {
  const units = Array.isArray(remote?.businessUnits) ? remote.businessUnits : [];
  const unit = units.find((candidate) => String(candidate?.operatorCode || '').toLowerCase() === 'fape')
    || units[0]
    || {};
  const regularPrice = numberOrNull(unit.price ?? remote?.price);
  const offerPrice = numberOrNull(unit.specialPrice ?? remote?.salePrice);
  const specialFromDate = unit.specialFromDate ?? unit.raw?.SpecialFromDate ?? null;
  const specialToDate = unit.specialToDate ?? unit.raw?.SpecialToDate ?? null;
  const offerIsActive = offerPrice != null && dateIsActive(specialFromDate, specialToDate, now);
  const effectivePrice = offerIsActive ? offerPrice : regularPrice;
  const sellerWarehouseQuantity = numberOrNull(stock?.sellerWarehouseQuantity) ?? 0;
  const fulfillmentQuantity = numberOrNull(stock?.fulfillmentQuantity) ?? 0;
  const availableQuantity = numberOrNull(stock?.availableQuantity)
    ?? sellerWarehouseQuantity + fulfillmentQuantity;
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
      stockSource: 'falabella_get_stock',
      sellerWarehouseQuantity,
      fulfillmentQuantity,
      sellerWarehouses: stock?.sellerWarehouses || [],
      fulfillmentWarehouses: stock?.fulfillmentWarehouses || [],
      status: remote?.status || null,
      qcStatus: remote?.qcStatus || null,
      marketplaceStatus: unit.status || remote?.status || null,
      isPublished: String(unit.isPublished ?? '').trim() === '1',
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
      const [productsResponse, stockResponse] = await Promise.all([
        core.falabellaGetProducts({
          companyId,
          filters: { filter: 'all', skuSellerList: sellerSkus, limit: Math.max(sellerSkus.length, 1) },
        }),
        core.falabellaGetStock({ companyId, sellerSkus, limit: Math.max(sellerSkus.length, 1) }),
      ]);
      const productsError = providerError(productsResponse);
      const stockError = providerError(stockResponse);
      if (productsError || productsResponse?.ok === false) throw httpError(`GetProducts: ${productsError || 'respuesta inválida'}`, 502);
      if (stockError || stockResponse?.ok === false) throw httpError(`GetStock: ${stockError || 'respuesta inválida'}`, 502);
      const productsBySku = new Map((productsResponse.products || []).map((product) => [String(product.sellerSku), product]));
      const stockBySku = new Map((stockResponse.stocks || []).map((stock) => [String(stock.sellerSku), stock]));
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
