let corePromise;

export function loadCore() {
  corePromise ||= import('@zentofact/core');
  return corePromise;
}

export function positiveInt(value, field = 'id') {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw httpError(`${field} inválido.`, 400);
  return parsed;
}

export function finiteNumber(value, field, { nullable = false } = {}) {
  if (nullable && (value === undefined || value === null || value === '')) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw httpError(`${field} inválido.`, 400);
  return parsed;
}

export function text(value, field, max = 200, { nullable = false } = {}) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    if (nullable) return null;
    throw httpError(`${field} es obligatorio.`, 400);
  }
  return normalized.slice(0, max);
}

export function jsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function httpError(message, status = 400, code) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

export function mapProduct(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    mainSku: row.main_sku,
    name: row.name,
    description: row.description,
    brand: row.brand,
    status: row.status,
    attributes: row.attributes || {},
    barcode: row.barcode,
    imageUrl: row.image_url,
    referencePrice: row.reference_price == null ? null : Number(row.reference_price),
    unit: row.unit,
    quantityOnHand: row.quantity_on_hand == null ? 0 : Number(row.quantity_on_hand),
    quantityReserved: row.quantity_reserved == null ? 0 : Number(row.quantity_reserved),
    available: row.available == null
      ? Number(row.quantity_on_hand || 0) - Number(row.quantity_reserved || 0)
      : Number(row.available),
    reorderPoint: row.reorder_point == null ? null : Number(row.reorder_point),
    listingsCount: row.listings_count == null ? undefined : Number(row.listings_count),
    sellersCount: row.sellers_count == null ? undefined : Number(row.sellers_count),
    channels: Array.isArray(row.channels) ? row.channels : [],
    sellerPriceMin: row.seller_price_min == null ? null : Number(row.seller_price_min),
    sellerPriceMax: row.seller_price_max == null ? null : Number(row.seller_price_max),
    sellerStockTotal: row.seller_stock_total == null ? 0 : Number(row.seller_stock_total),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

export function mapListing(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    productId: Number(row.product_id),
    channelCode: row.channel_code,
    companyId: Number(row.company_id),
    companyName: row.company_name,
    channelAccountId: row.channel_account_id == null ? null : Number(row.channel_account_id),
    sellerSku: row.seller_sku,
    shopSku: row.shop_sku,
    externalProductId: row.external_product_id,
    title: row.title,
    status: row.status,
    marketplaceQuantity: row.marketplace_quantity == null ? null : Number(row.marketplace_quantity),
    marketplaceSyncedAt: row.marketplace_synced_at,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COMPACT_LISTING_METADATA_KEYS = [
  'effectivePrice', 'price', 'regularPrice', 'offerPrice', 'offerIsActive',
  'sellerWarehouseQuantity', 'fulfillmentQuantity', 'stockSource',
  'isSellable', 'sellabilityReason', 'contentScore',
  'isPublished', 'status', 'marketplaceStatus', 'qcStatus',
  'url',
];

export function mapCompactListing(row) {
  if (!row) return null;
  const source = jsonObject(row.metadata);
  const metadata = {};
  for (const key of COMPACT_LISTING_METADATA_KEYS) {
    if (Object.hasOwn(source, key)) metadata[key] = source[key];
  }
  return {
    id: Number(row.id),
    productId: Number(row.product_id),
    channelCode: row.channel_code,
    companyId: Number(row.company_id),
    companyName: row.company_name,
    sellerSku: row.seller_sku,
    shopSku: row.shop_sku,
    title: row.title,
    status: row.status,
    marketplaceQuantity: row.marketplace_quantity == null ? null : Number(row.marketplace_quantity),
    metadata,
  };
}

export async function inTransaction(db, work) {
  if (db) return work(db);
  const { pool } = await loadCore();
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
