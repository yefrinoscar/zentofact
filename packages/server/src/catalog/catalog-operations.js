import { inventoryConfig } from './inventory-service.js';
import { limaDate, limaDaySql, limaToday } from './product-service.js';
import { stockPhase } from './stock-phase.js';
import { stockCommitmentAction } from './stock-commitment.js';
import { httpError, inTransaction, loadCore, positiveInt, text } from './utils.js';

const READY_FULFILLMENT_SQL = `'ready_to_ship','shipped','delivered'`;

function limaOffset(days) {
  const [year, month, day] = limaToday().split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

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
         and o.fulfillment_status in ('pending','preparing','ready_to_ship','shipped','delivered')
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

export async function applyReadyOrderStock(input = {}, db) {
  const orderId = input.orderId == null ? null : positiveInt(input.orderId, 'orderId');
  const companyId = orderId ? null : positiveInt(input.companyId, 'companyId');
  const externalOrderId = orderId ? null : text(input.externalOrderId, 'externalOrderId', 300);
  return inTransaction(db, async (client) => {
    const order = (await client.query(
      `select o.*, a.id as account_id, a.settings, ch.code as channel_code
       from orders o
       join order_channel_accounts a on a.id=o.channel_account_id
       join order_channels ch on ch.id=a.channel_id
       where ${orderId
    ? 'o.id=$1'
    : `o.company_id=$1 and o.external_order_id=$2
       and (select count(*) from orders candidate
            where candidate.company_id=$1 and candidate.external_order_id=$2)=1`}
       for update of o`,
      orderId ? [orderId] : [companyId, externalOrderId],
    )).rows[0];
    if (!order) return { applied: 0, skipped: 0, reversed: 0, missing: true };
    const existing = { ...order };
    if (
      ['cancelled', 'failed'].includes(order.order_status)
      || order.fulfillment_status === 'returned'
    ) {
      const items = (await client.query(
        `select id, external_item_id, sku, provider_sku, quantity, product_id, listing_id,
           main_sku, stock_state, stock_applied_quantity, stock_revision, provider_status
         from order_items where order_id=$1 for update`,
        [order.id],
      )).rows;
      const result = await stockPhase({
        db: client,
        existing,
        persisted: order,
        account: { id: order.account_id, channelCode: order.channel_code, settings: order.settings || {} },
        upsertedItems: items,
        doomedItems: [],
        source: input.source || 'webhook',
        actorUserId: input.actorUserId,
        enabled: true,
        allowNegative: input.allowNegative,
      });
      return {
        ...result,
        orderId: Number(order.id),
        orderNumber: order.external_order_number,
        itemCount: items.length,
      };
    }
    if (stockCommitmentAction(order.fulfillment_status) === 'none') {
      return {
        applied: 0,
        skipped: 0,
        reversed: 0,
        reserved: 0,
        orderId: Number(order.id),
        orderNumber: order.external_order_number,
        ignored: true,
      };
    }
    const items = (await client.query(
      `select id, external_item_id, sku, provider_sku, quantity, product_id, listing_id,
         main_sku, stock_state, stock_applied_quantity, stock_revision, provider_status
       from order_items where order_id=$1 for update`,
      [order.id],
    )).rows;
    const result = await stockPhase({
      db: client,
      existing,
      persisted: order,
      account: { id: order.account_id, channelCode: order.channel_code, settings: order.settings || {} },
      upsertedItems: items,
      doomedItems: [],
      source: input.source || 'webhook',
      actorUserId: input.actorUserId,
      enabled: true,
      includeSkippedPolicy: input.includeSkippedPolicy === true,
      allowNegative: input.allowNegative,
    });
    return {
      ...result,
      orderId: Number(order.id),
      orderNumber: order.external_order_number,
      itemCount: items.length,
    };
  });
}

export async function applyStockForOperationalDate(input = {}, db) {
  const date = limaDate(input.date || limaOffset(-1));
  const dryRun = input.dryRun === true;
  const target = db || (await loadCore()).pool;
  const orders = await target.query(
    `select o.id, o.company_id, o.external_order_id, o.external_order_number,
       o.fulfillment_status, o.order_status,
       count(oi.id)::int as item_count,
       count(oi.id) filter (
         where oi.stock_applied_quantity = 0
           and oi.stock_state in ('none','skipped_policy','skipped_unmapped','skipped_insufficient')
       )::int as pending_count
     from orders o
     join order_items oi on oi.order_id=o.id
     left join falabella_orders fo
       on fo.company_id=o.company_id and fo.order_id=o.external_order_id
     where o.order_status not in ('cancelled','failed')
       and (
         o.fulfillment_status in (${READY_FULFILLMENT_SQL})
         or lower(coalesce(fo.status, '')) ~ '(ready_to_ship|shipped|delivered)'
       )
       and ${limaDaySql('coalesce(o.promised_shipping_at, o.ordered_at)')}
     group by o.id
     order by o.id`,
    [date],
  );
  const preview = orders.rows.map((row) => ({
    orderId: Number(row.id),
    companyId: Number(row.company_id),
    externalOrderId: row.external_order_id,
    orderNumber: row.external_order_number,
    fulfillmentStatus: row.fulfillment_status,
    itemCount: Number(row.item_count),
    pendingCount: Number(row.pending_count),
  }));
  if (dryRun) {
    return {
      date,
      dryRun: true,
      orders: preview.length,
      pendingOrders: preview.filter((order) => order.pendingCount > 0).length,
      pendingItems: preview.reduce((sum, order) => sum + order.pendingCount, 0),
      sample: preview.filter((order) => order.pendingCount > 0).slice(0, 20),
    };
  }
  const stats = {
    date,
    dryRun: false,
    orders: 0,
    applied: 0,
    skipped: 0,
    reversed: 0,
    missing: 0,
    errors: [],
  };
  for (const order of preview.filter((row) => row.pendingCount > 0)) {
    try {
      const result = await applyReadyOrderStock({
        companyId: order.companyId,
        externalOrderId: order.externalOrderId,
        source: input.source || 'system',
        actorUserId: input.actorUserId,
        includeSkippedPolicy: true,
        allowNegative: input.allowNegative,
      }, db);
      stats.orders += 1;
      stats.applied += Number(result.applied || 0);
      stats.skipped += Number(result.skipped || 0);
      stats.reversed += Number(result.reversed || 0);
      if (result.missing) stats.missing += 1;
    } catch (error) {
      stats.errors.push({
        orderId: order.orderId,
        orderNumber: order.orderNumber,
        message: String(error?.message || error),
      });
    }
  }
  return stats;
}
