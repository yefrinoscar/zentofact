import { enqueueStockJob } from './stock-jobs.js';
import { INVENTORY_LISTEN_FROM_AT } from './stock-commitment.js';
import { upsertListing } from './listing-service.js';
import { httpError, inTransaction, loadCore, positiveInt } from './utils.js';

async function target(db) {
  return db || (await loadCore()).pool;
}

function normalized(value) {
  return String(value ?? '').trim();
}

function mapUnmatched(row) {
  return {
    orderItemId: Number(row.order_item_id),
    companyId: Number(row.company_id),
    company: row.company,
    channelCode: row.channel_code,
    channelAccountId: Number(row.channel_account_id),
    sellerSku: row.seller_sku,
    shopSku: row.shop_sku || null,
    title: row.title,
    lineCount: Number(row.line_count || 0),
    quantity: Number(row.quantity || 0),
    orderNumbers: row.order_numbers || [],
  };
}

export async function listUnmatchedStockItems(db) {
  const client = await target(db);
  const result = await client.query(
    `select min(oi.id) as order_item_id,
            o.company_id,
            coalesce(nullif(c.nombre_comercial, ''), nullif(c.nombre, ''), c.razon_social) as company,
            channel.code as channel_code,
            min(o.channel_account_id) as channel_account_id,
            coalesce(nullif(trim(oi.sku), ''), nullif(trim(oi.provider_sku), '')) as seller_sku,
            max(nullif(trim(oi.provider_sku), '')) as shop_sku,
            max(nullif(trim(oi.description), '')) as title,
            count(*)::int as line_count,
            coalesce(sum(oi.quantity), 0) as quantity,
            array_agg(distinct o.external_order_number order by o.external_order_number) as order_numbers
       from order_items oi
       join orders o on o.id=oi.order_id
       join companies c on c.id=o.company_id
       join order_channel_accounts account on account.id=o.channel_account_id
       join order_channels channel on channel.id=account.channel_id
      where oi.stock_state='skipped_unmapped'
        and oi.product_id is null
        and o.order_status not in ('cancelled','failed')
        and o.fulfillment_status in ('pending','preparing','ready_to_ship','shipped','delivered')
        and o.items_status='complete'
        and o.ordered_at >= $1::timestamptz
        and coalesce(nullif(trim(oi.sku), ''), nullif(trim(oi.provider_sku), '')) is not null
      group by o.company_id, company, channel.code,
               coalesce(nullif(trim(oi.sku), ''), nullif(trim(oi.provider_sku), ''))
      order by min(o.ordered_at), min(oi.id)`,
    [INVENTORY_LISTEN_FROM_AT],
  );
  return result.rows.map(mapUnmatched);
}

export async function assignUnmatchedStockItem(input = {}, db, dependencies = {}) {
  const orderItemId = positiveInt(input.orderItemId, 'orderItemId');
  const productId = positiveInt(input.productId, 'productId');
  const saveListing = dependencies.upsertListing || upsertListing;
  const enqueue = dependencies.enqueue || enqueueStockJob;

  const assigned = await inTransaction(db, async (client) => {
    const item = (await client.query(
      `select oi.id as order_item_id,
              o.company_id,
              o.channel_account_id,
              channel.code as channel_code,
              coalesce(nullif(trim(oi.sku), ''), nullif(trim(oi.provider_sku), '')) as seller_sku,
              nullif(trim(oi.provider_sku), '') as shop_sku,
              nullif(trim(oi.description), '') as title,
              oi.stock_state
         from order_items oi
         join orders o on o.id=oi.order_id
         join order_channel_accounts account on account.id=o.channel_account_id
         join order_channels channel on channel.id=account.channel_id
        where oi.id=$1
        for update of oi`,
      [orderItemId],
    )).rows[0];
    if (!item) throw httpError('Artículo de pedido no encontrado.', 404);
    if (item.stock_state !== 'skipped_unmapped') {
      throw httpError('Este artículo ya no está pendiente de asociación.', 409, 'stock_item_already_resolved');
    }
    const sellerSku = normalized(item.seller_sku);
    if (!sellerSku) throw httpError('Este artículo no tiene un seller SKU asociable.', 400);

    const product = (await client.query(
      `select id, main_sku, name from products
        where id=$1 and status <> 'archived'`,
      [productId],
    )).rows[0];
    if (!product) throw httpError('Producto maestro no encontrado.', 404);

    const listing = await saveListing(productId, {
      companyId: Number(item.company_id),
      channelAccountId: Number(item.channel_account_id),
      channelCode: item.channel_code,
      sellerSku,
      shopSku: item.shop_sku || null,
      title: item.title || null,
      metadata: { source: 'stock_unmatched_assignment', orderItemId },
    }, client);

    const updated = await client.query(
      `update order_items oi
          set product_id=$2,
              listing_id=$1,
              main_sku=$3,
              stock_state='none',
              stock_applied_quantity=0,
              updated_at=now()
         from orders o
         join order_channel_accounts account on account.id=o.channel_account_id
         join order_channels channel on channel.id=account.channel_id
        where oi.order_id=o.id
          and oi.stock_state='skipped_unmapped'
          and oi.product_id is null
          and o.order_status not in ('cancelled','failed')
          and o.fulfillment_status in ('pending','preparing','ready_to_ship','shipped','delivered')
          and o.items_status='complete'
          and o.ordered_at >= $4::timestamptz
          and o.company_id=$5
          and channel.code=$6
          and coalesce(nullif(trim(oi.sku), ''), nullif(trim(oi.provider_sku), ''))=$7
        returning oi.id as order_item_id, o.id as order_id, o.company_id,
                  o.external_order_id, o.external_order_number as order_number`,
      [Number(listing.id), productId, product.main_sku, INVENTORY_LISTEN_FROM_AT,
        Number(item.company_id), item.channel_code, sellerSku],
    );
    if (!updated.rows.length) {
      throw httpError('La asociación cambió mientras se procesaba. Actualiza e intenta nuevamente.', 409);
    }
    return { listing, product, rows: updated.rows };
  });

  const uniqueOrders = [...new Map(assigned.rows.map((row) => [Number(row.order_id), row])).values()];
  for (const order of uniqueOrders) {
    await enqueue({
      orderId: Number(order.order_id),
      companyId: Number(order.company_id),
      externalOrderId: order.external_order_id,
      orderNumber: order.order_number,
      source: 'association',
    }, db);
  }

  return {
    product: {
      id: Number(assigned.product.id),
      mainSku: assigned.product.main_sku,
      name: assigned.product.name,
    },
    listing: assigned.listing,
    updatedItems: assigned.rows.length,
    ordersQueued: uniqueOrders.length,
  };
}
