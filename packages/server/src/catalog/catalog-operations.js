import { inventoryConfig } from './inventory-service.js';
import { stockPhase } from './stock-phase.js';
import { httpError, inTransaction, loadCore, positiveInt } from './utils.js';

export async function listUnmappedSkus(filters = {}, db) {
  const target = db || (await loadCore()).pool;
  const values = [];
  const where = [`oi.stock_state in ('skipped_unmapped', 'skipped_insufficient')`];
  if (filters.companyId) {
    values.push(positiveInt(filters.companyId, 'companyId'));
    where.push(`o.company_id=$${values.length}`);
  }
  if (filters.channelCode) {
    values.push(String(filters.channelCode).trim().toLowerCase());
    where.push(`ch.code=$${values.length}`);
  }
  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);
  values.push(limit);
  const result = await target.query(
    `select oi.id as order_item_id, oi.external_item_id, oi.sku, oi.provider_sku,
       oi.quantity, oi.stock_state, oi.stock_applied_quantity, oi.stock_revision,
       oi.product_id, oi.listing_id, o.id as order_id, o.external_order_number,
       o.company_id, o.order_status, ch.code as channel_code,
       coalesce(nullif(c.nombre, ''), nullif(c.nombre_comercial, ''), c.razon_social) as company_name
     from order_items oi
     join orders o on o.id=oi.order_id
     join order_channel_accounts a on a.id=o.channel_account_id
     join order_channels ch on ch.id=a.channel_id
     join companies c on c.id=o.company_id
     where ${where.join(' and ')}
     order by oi.updated_at desc, oi.id desc limit $${values.length}`,
    values,
  );
  return result.rows.map((row) => ({
    orderItemId: Number(row.order_item_id),
    externalItemId: row.external_item_id,
    sku: row.sku,
    providerSku: row.provider_sku,
    quantity: Number(row.quantity),
    stockState: row.stock_state,
    stockAppliedQuantity: Number(row.stock_applied_quantity),
    stockRevision: Number(row.stock_revision),
    productId: row.product_id == null ? null : Number(row.product_id),
    listingId: row.listing_id == null ? null : Number(row.listing_id),
    orderId: Number(row.order_id),
    orderNumber: row.external_order_number,
    companyId: Number(row.company_id),
    companyName: row.company_name,
    orderStatus: row.order_status,
    channelCode: row.channel_code,
  }));
}

export async function applyStockToOpenOrders(listingIdInput, input = {}, db) {
  const listingId = positiveInt(listingIdInput, 'listingId');
  return inTransaction(db, async (client) => {
    const listing = (await client.query(
      `select l.*, p.main_sku from product_listings l join products p on p.id=l.product_id
       where l.id=$1 and l.status='active' for update`,
      [listingId],
    )).rows[0];
    if (!listing) throw httpError('Listing activo no encontrado.', 404);
    const rows = (await client.query(
      `select oi.*, o.company_id, o.channel_account_id, o.order_status, o.fulfillment_status,
         o.id as persisted_order_id, a.settings, ch.code as channel_code
       from order_items oi
       join orders o on o.id=oi.order_id
       join order_channel_accounts a on a.id=o.channel_account_id
       join order_channels ch on ch.id=a.channel_id
       where o.company_id=$1 and ch.code=$2
         and o.order_status in ('confirmed','completed')
         and oi.stock_state in ('skipped_unmapped','skipped_insufficient')
         and (oi.sku=$3 or (nullif($4, '') is not null and oi.provider_sku=$4))
       order by o.id, oi.id for update of oi`,
      [listing.company_id, listing.channel_code, listing.seller_sku, listing.shop_sku || ''],
    )).rows;
    let applied = 0;
    let skipped = 0;
    for (const row of rows) {
      await client.query(
        `update order_items set product_id=$1, listing_id=$2, main_sku=$3, updated_at=now()
         where id=$4`,
        [listing.product_id, listing.id, listing.main_sku, row.id],
      );
      row.product_id = listing.product_id;
      row.listing_id = listing.id;
      row.main_sku = listing.main_sku;
      const persisted = {
        id: row.persisted_order_id,
        company_id: row.company_id,
        order_status: row.order_status,
        fulfillment_status: row.fulfillment_status,
      };
      const result = await stockPhase({
        db: client,
        existing: { ...persisted },
        persisted,
        account: { id: row.channel_account_id, channelCode: row.channel_code, settings: row.settings || {} },
        upsertedItems: [row],
        doomedItems: [],
        source: 'sync',
        actorUserId: input.actorUserId,
        enabled: true,
        allowNegative: input.allowNegative ?? inventoryConfig.allowNegativeMarketplace,
      });
      applied += result.applied;
      skipped += result.skipped;
    }
    return { listingId, matched: rows.length, applied, skipped };
  });
}
