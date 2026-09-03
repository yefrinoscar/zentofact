import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import pg from 'pg';

config({ path: resolve('.env') });

const { values } = parseArgs({
  options: {
    sku: { type: 'string' },
    channel: { type: 'string' },
    since: { type: 'string' },
    'expect-min': { type: 'string' },
  },
});

const sku = String(values.sku || '').trim().toUpperCase();
const channel = String(values.channel || '').trim().toLowerCase();
const sinceInput = String(values.since || '').trim();
const since = new Date(sinceInput);
const expectMin = values['expect-min'] == null ? null : Number(values['expect-min']);

if (!sku) throw new Error('Indica el producto con --sku.');
if (!channel) throw new Error('Indica el canal con --channel.');
if (!sinceInput || Number.isNaN(since.getTime())) throw new Error('Indica una fecha ISO válida con --since.');
if (expectMin != null && (!Number.isFinite(expectMin) || expectMin < 0)) {
  throw new Error('--expect-min debe ser un número no negativo.');
}

const connectionString = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL_POSTGRES;
if (!connectionString) throw new Error('Falta DATABASE_PUBLIC_URL o DATABASE_URL_POSTGRES.');

const pool = new pg.Pool({ connectionString });
const client = await pool.connect();

try {
  await client.query('begin isolation level repeatable read read only');

  const productResult = await client.query(
    `select p.id,p.main_sku,p.name,i.quantity_on_hand,i.quantity_reserved
     from products p
     join product_inventory i on i.product_id=p.id
     where upper(p.main_sku)=$1`,
    [sku],
  );
  if (productResult.rowCount !== 1) {
    throw new Error(`Se esperaba un producto ${sku}; se encontraron ${productResult.rowCount}.`);
  }
  const product = productResult.rows[0];

  const listingsResult = await client.query(
    `select l.id,l.company_id,l.seller_sku,l.shop_sku,l.status
     from product_listings l
     where l.product_id=$1 and l.channel_code=$2
     order by l.company_id,l.id`,
    [product.id, channel],
  );

  const ignoredWords = new Set(['para', 'consola']);
  const searchTerms = product.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term, index, all) => term.length >= 5 && !ignoredWords.has(term) && all.indexOf(term) === index);

  const candidatesResult = await client.query(
    `select oi.id as order_item_id,oi.product_id,oi.listing_id,oi.sku,oi.provider_sku,
       oi.quantity,oi.total as item_total,oi.provider_status as item_provider_status,
       oi.stock_state,oi.stock_applied_quantity,
       o.id as order_id,o.external_order_number,o.ordered_at,o.created_at,
       o.order_status,o.payment_status,o.fulfillment_status,o.provider_status as order_provider_status,
       coalesce(nullif(c.nombre_comercial,''),nullif(c.nombre,''),c.razon_social) as company_name,
       case
         when oi.product_id=$1 then 'product_id'
         when linked.product_id=$1 then 'listing_id'
         when matched.product_id=$1 then 'seller_or_shop_sku'
         else 'unmatched'
       end as match_source,
       (
         o.order_status not in ('cancelled','failed')
         and o.payment_status not in ('refunded','failed')
         and o.fulfillment_status not in ('cancelled','returned','failed')
         and lower(coalesce(o.provider_status,'')) !~ '(return|cancel|failed)'
         and lower(coalesce(oi.provider_status,'')) !~ '(return|cancel|failed)'
       ) as active_sale,
       (
         o.order_status in ('confirmed','completed')
         and coalesce(o.fulfillment_status,'') <> 'returned'
         and lower(coalesce(oi.provider_status,'')) !~ '(return|cancel|failed)'
       ) as strict_sale
     from order_items oi
     join orders o on o.id=oi.order_id
     join order_channel_accounts account on account.id=o.channel_account_id
     join order_channels ch on ch.id=account.channel_id
     left join companies c on c.id=o.company_id
     left join product_listings linked on linked.id=oi.listing_id
     left join lateral (
       select l.product_id
       from product_listings l
       where l.company_id=o.company_id
         and l.channel_code=ch.code
         and l.status='active'
         and (
           (nullif(trim(oi.sku),'') is not null and l.seller_sku=oi.sku)
           or (nullif(trim(oi.provider_sku),'') is not null and l.shop_sku=oi.provider_sku)
           or (nullif(trim(oi.sku),'') is not null and l.shop_sku=oi.sku)
         )
       order by
         case
           when nullif(trim(oi.sku),'') is not null and l.seller_sku=oi.sku then 0
           when nullif(trim(oi.provider_sku),'') is not null and l.shop_sku=oi.provider_sku then 1
           else 2
         end,
         l.id
       limit 1
     ) matched on true
     where ch.code=$2
       and coalesce(o.ordered_at,o.created_at) >= $3::timestamptz
       and coalesce(oi.product_id,linked.product_id,matched.product_id)=$1
     order by coalesce(o.ordered_at,o.created_at),o.id,oi.id`,
    [product.id, channel, since.toISOString()],
  );

  const candidates = candidatesResult.rows.map((row) => ({
    orderItemId: Number(row.order_item_id),
    orderId: Number(row.order_id),
    orderNumber: row.external_order_number,
    orderedAt: row.ordered_at || row.created_at,
    companyName: row.company_name,
    sku: row.sku,
    providerSku: row.provider_sku,
    matchSource: row.match_source,
    quantity: Number(row.quantity),
    total: Number(row.item_total || 0),
    orderStatus: row.order_status,
    paymentStatus: row.payment_status,
    fulfillmentStatus: row.fulfillment_status,
    orderProviderStatus: row.order_provider_status,
    itemProviderStatus: row.item_provider_status,
    stockState: row.stock_state,
    stockAppliedQuantity: Number(row.stock_applied_quantity || 0),
    activeSale: row.active_sale,
    strictSale: row.strict_sale,
  }));

  const rawSearchResult = await client.query(
    `select oi.id as order_item_id,oi.product_id,oi.listing_id,oi.main_sku,oi.sku,oi.provider_sku,
       oi.description,oi.quantity,oi.total as item_total,oi.provider_status as item_provider_status,
       oi.stock_state,oi.stock_applied_quantity,
       o.id as order_id,o.external_order_number,coalesce(o.ordered_at,o.created_at) as ordered_at,
       o.order_status,o.payment_status,o.fulfillment_status,o.provider_status as order_provider_status,
       coalesce(nullif(c.nombre_comercial,''),nullif(c.nombre,''),c.razon_social) as company_name,
       (select count(*)::int from unnest($3::text[]) term
         where lower(translate(oi.description,'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')) like '%' || term || '%') as matched_terms
     from order_items oi
     join orders o on o.id=oi.order_id
     join order_channel_accounts account on account.id=o.channel_account_id
     join order_channels ch on ch.id=account.channel_id
     left join companies c on c.id=o.company_id
     where ch.code=$1
       and coalesce(o.ordered_at,o.created_at) >= $2::timestamptz
       and (
         upper(coalesce(oi.main_sku,''))=$4
         or exists (
           select 1 from unnest($3::text[]) term
           where lower(translate(oi.description,'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun')) like '%' || term || '%'
         )
       )
     order by matched_terms desc,coalesce(o.ordered_at,o.created_at) desc,o.id desc
     limit 100`,
    [channel, since.toISOString(), searchTerms, sku],
  );
  const rawSearchCandidates = rawSearchResult.rows.map((row) => ({
    orderItemId: Number(row.order_item_id),
    orderId: Number(row.order_id),
    orderNumber: row.external_order_number,
    orderedAt: row.ordered_at,
    companyName: row.company_name,
    productId: row.product_id == null ? null : Number(row.product_id),
    listingId: row.listing_id == null ? null : Number(row.listing_id),
    mainSku: row.main_sku,
    sku: row.sku,
    providerSku: row.provider_sku,
    description: row.description,
    matchedTerms: Number(row.matched_terms),
    quantity: Number(row.quantity),
    total: Number(row.item_total || 0),
    orderStatus: row.order_status,
    paymentStatus: row.payment_status,
    fulfillmentStatus: row.fulfillment_status,
    orderProviderStatus: row.order_provider_status,
    itemProviderStatus: row.item_provider_status,
    stockState: row.stock_state,
    stockAppliedQuantity: Number(row.stock_applied_quantity || 0),
  }));
  const channelActivityResult = await client.query(
    `select count(distinct o.id)::int as orders_count,
       count(oi.id)::int as item_rows,
       max(coalesce(o.ordered_at,o.created_at)) as latest_order_at
     from orders o
     join order_channel_accounts account on account.id=o.channel_account_id
     join order_channels ch on ch.id=account.channel_id
     left join order_items oi on oi.order_id=o.id
     where ch.code=$1 and coalesce(o.ordered_at,o.created_at) >= $2::timestamptz`,
    [channel, since.toISOString()],
  );
  const availableChannelsResult = await client.query(
    `select ch.code,ch.name,
       count(distinct o.id) filter (where coalesce(o.ordered_at,o.created_at) >= $1::timestamptz)::int as orders_since,
       max(coalesce(o.ordered_at,o.created_at)) as latest_order_at
     from order_channels ch
     left join order_channel_accounts account on account.channel_id=ch.id
     left join orders o on o.channel_account_id=account.id
     group by ch.id,ch.code,ch.name
     order by ch.code`,
    [since.toISOString()],
  );
  const recentChannelItemsResult = await client.query(
    `select o.id as order_id,o.external_order_number,coalesce(o.ordered_at,o.created_at) as ordered_at,
       o.order_status,o.payment_status,o.fulfillment_status,o.provider_status as order_provider_status,
       oi.id as order_item_id,oi.product_id,oi.listing_id,oi.main_sku,oi.sku,oi.provider_sku,
       oi.description,oi.quantity,oi.total as item_total,oi.provider_status as item_provider_status,
       oi.stock_state,oi.stock_applied_quantity,
       coalesce(nullif(c.nombre_comercial,''),nullif(c.nombre,''),c.razon_social) as company_name
     from orders o
     join order_channel_accounts account on account.id=o.channel_account_id
     join order_channels ch on ch.id=account.channel_id
     left join order_items oi on oi.order_id=o.id
     left join companies c on c.id=o.company_id
     where ch.code=$1 and coalesce(o.ordered_at,o.created_at) >= $2::timestamptz
     order by coalesce(o.ordered_at,o.created_at) desc,o.id desc,oi.id
     limit 50`,
    [channel, since.toISOString()],
  );
  const active = candidates.filter((row) => row.activeSale);
  const strict = candidates.filter((row) => row.strictSale);
  const summary = (rows) => ({
    ordersCount: new Set(rows.map((row) => row.orderId)).size,
    unitsSold: rows.reduce((sum, row) => sum + row.quantity, 0),
    revenue: rows.reduce((sum, row) => sum + row.total, 0),
  });

  const output = {
    sku: product.main_sku,
    productId: Number(product.id),
    name: product.name,
    channel,
    sinceLima: sinceInput,
    sinceUtc: since.toISOString(),
    stock: Number(product.quantity_on_hand),
    reserved: Number(product.quantity_reserved),
    listings: listingsResult.rows.map((row) => ({
      id: Number(row.id),
      companyId: Number(row.company_id),
      sellerSku: row.seller_sku,
      shopSku: row.shop_sku,
      status: row.status,
    })),
    searchTerms,
    activeSales: summary(active),
    strictSales: summary(strict),
    candidates,
    rawSearchCandidates,
    channelActivity: {
      ordersCount: Number(channelActivityResult.rows[0]?.orders_count || 0),
      itemRows: Number(channelActivityResult.rows[0]?.item_rows || 0),
      latestOrderAt: channelActivityResult.rows[0]?.latest_order_at || null,
    },
    availableChannels: availableChannelsResult.rows.map((row) => ({
      code: row.code,
      name: row.name,
      ordersSince: Number(row.orders_since || 0),
      latestOrderAt: row.latest_order_at || null,
    })),
    recentChannelItems: recentChannelItemsResult.rows.map((row) => ({
      orderId: Number(row.order_id),
      orderNumber: row.external_order_number,
      orderedAt: row.ordered_at,
      companyName: row.company_name,
      orderStatus: row.order_status,
      paymentStatus: row.payment_status,
      fulfillmentStatus: row.fulfillment_status,
      orderProviderStatus: row.order_provider_status,
      orderItemId: row.order_item_id == null ? null : Number(row.order_item_id),
      productId: row.product_id == null ? null : Number(row.product_id),
      listingId: row.listing_id == null ? null : Number(row.listing_id),
      mainSku: row.main_sku,
      sku: row.sku,
      providerSku: row.provider_sku,
      description: row.description,
      quantity: row.quantity == null ? null : Number(row.quantity),
      total: row.item_total == null ? null : Number(row.item_total),
      itemProviderStatus: row.item_provider_status,
      stockState: row.stock_state,
      stockAppliedQuantity: Number(row.stock_applied_quantity || 0),
    })),
  };
  console.log(JSON.stringify(output));

  if (expectMin != null && output.activeSales.unitsSold < expectMin) {
    throw new Error(`Se esperaban al menos ${expectMin} unidades activas; se encontraron ${output.activeSales.unitsSold}.`);
  }

  await client.query('rollback');
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  client.release();
  await pool.end();
}
