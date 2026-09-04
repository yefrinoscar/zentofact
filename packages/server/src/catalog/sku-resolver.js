import { loadCore, positiveInt, text } from './utils.js';

function resolvedRow(row) {
  return {
    listing: {
      id: Number(row.listing_id),
      productId: Number(row.product_id),
      channelCode: row.channel_code,
      companyId: Number(row.company_id),
      sellerSku: row.seller_sku,
      shopSku: row.shop_sku,
    },
    product: {
      id: Number(row.product_id),
      mainSku: row.main_sku,
      name: row.product_name,
      status: row.product_status,
      quantityOnHand: Number(row.quantity_on_hand || 0),
    },
  };
}

export async function resolveListing(dbInput, input) {
  const db = dbInput || (await loadCore()).pool;
  const channelCode = text(input.channelCode, 'channelCode', 50).toLowerCase();
  const companyId = positiveInt(input.companyId, 'companyId');
  const sellerSku = String(input.sellerSku || '').trim();
  const shopSku = String(input.shopSku || '').trim();
  const select = `select l.id as listing_id, l.product_id, l.channel_code, l.company_id,
      l.seller_sku, l.shop_sku, p.main_sku, p.name as product_name, p.status as product_status,
      i.quantity_on_hand
    from product_listings l
    join products p on p.id=l.product_id
    join product_inventory i on i.product_id=p.id`;

  if (sellerSku) {
    const result = await db.query(
      `${select}
       where l.channel_code=$1 and l.company_id=$2 and l.seller_sku=$3 and l.status='active'
       limit 1`,
      [channelCode, companyId, sellerSku],
    );
    if (result.rows.length) return resolvedRow(result.rows[0]);
  }
  if (shopSku) {
    const result = await db.query(
      `${select}
       where l.channel_code=$1 and l.company_id=$2 and l.shop_sku=$3 and l.status='active'
       order by l.id limit 2`,
      [channelCode, companyId, shopSku],
    );
    if (result.rows.length === 1) return resolvedRow(result.rows[0]);
    if (result.rows.length > 1) {
      console.warn(JSON.stringify({ event: 'catalog.sku.unmapped', reason: 'ambiguous_shop_sku', channelCode, companyId, shopSku }));
      return { unmapped: true, reason: 'ambiguous_shop_sku' };
    }
  }
  if (channelCode === 'ripley' && sellerSku && shopSku && sellerSku !== shopSku) {
    const swappedSeller = await db.query(
      `${select}
       where l.channel_code=$1 and l.company_id=$2 and l.seller_sku=$3 and l.status='active'
       limit 1`,
      [channelCode, companyId, shopSku],
    );
    if (swappedSeller.rows.length) return resolvedRow(swappedSeller.rows[0]);
    const swappedShop = await db.query(
      `${select}
       where l.channel_code=$1 and l.company_id=$2 and l.shop_sku=$3 and l.status='active'
       order by l.id limit 2`,
      [channelCode, companyId, sellerSku],
    );
    if (swappedShop.rows.length === 1) return resolvedRow(swappedShop.rows[0]);
  }
  console.warn(JSON.stringify({ event: 'catalog.sku.unmapped', reason: 'not_found', channelCode, companyId, sellerSku, shopSku }));
  return { unmapped: true, reason: 'not_found' };
}

export async function previewResolveSku(input, db) {
  const result = await resolveListing(db, input);
  if (!result.unmapped || input.allowMainSkuFallback !== true) return result;
  const target = db || (await loadCore()).pool;
  const candidate = String(input.sellerSku || '').trim();
  if (!candidate) return result;
  const productResult = await target.query(
    `select p.id as product_id, p.main_sku, p.name as product_name, p.status as product_status,
       i.quantity_on_hand from products p join product_inventory i on i.product_id=p.id
     where p.main_sku=$1 limit 1`,
    [candidate],
  );
  if (!productResult.rows.length) return result;
  const row = productResult.rows[0];
  return {
    previewFallback: true,
    listing: null,
    product: {
      id: Number(row.product_id), mainSku: row.main_sku, name: row.product_name,
      status: row.product_status, quantityOnHand: Number(row.quantity_on_hand),
    },
  };
}
