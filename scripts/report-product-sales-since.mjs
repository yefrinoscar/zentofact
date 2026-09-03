import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import pg from 'pg';

config({ path: resolve('.env') });

const { values } = parseArgs({
  options: {
    sku: { type: 'string' },
    since: { type: 'string' },
    channels: { type: 'string' },
  },
});

const sku = String(values.sku || '').trim().toUpperCase();
const sinceInput = String(values.since || '').trim();
const since = new Date(sinceInput);
const channels = String(values.channels || '')
  .split(',')
  .map((channel) => channel.trim().toLowerCase())
  .filter((channel, index, all) => channel && all.indexOf(channel) === index);

if (!sku) throw new Error('Indica el producto con --sku.');
if (!sinceInput || Number.isNaN(since.getTime())) {
  throw new Error('Indica una fecha ISO válida con --since.');
}

const connectionString = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL_POSTGRES;
if (!connectionString) throw new Error('Falta DATABASE_PUBLIC_URL o DATABASE_URL_POSTGRES.');

const pool = new pg.Pool({ connectionString });
const client = await pool.connect();

try {
  await client.query('begin isolation level repeatable read read only');

  const productResult = await client.query(
    `select p.id,p.main_sku,p.name,
       coalesce(i.quantity_on_hand,0) as quantity_on_hand,
       coalesce(i.quantity_reserved,0) as quantity_reserved
     from products p
     left join product_inventory i on i.product_id=p.id
     where upper(p.main_sku)=$1`,
    [sku],
  );
  if (productResult.rowCount !== 1) {
    throw new Error(`Se esperaba un producto ${sku}; se encontraron ${productResult.rowCount}.`);
  }

  const product = productResult.rows[0];
  const salesResult = await client.query(
    `select o.id as order_id,o.external_order_number,o.ordered_at,
       ch.code as channel_code,ch.name as channel_name,
       coalesce(nullif(c.nombre_comercial,''),nullif(c.nombre,''),c.razon_social) as company_name,
       sum(oi.quantity)::numeric as units,
       sum(coalesce(oi.total,oi.unit_price*oi.quantity,0))::numeric as total
     from order_items oi
     join orders o on o.id=oi.order_id
     join order_channel_accounts account on account.id=o.channel_account_id
     join order_channels ch on ch.id=account.channel_id
     left join falabella_orders fo
       on fo.company_id=o.company_id and fo.order_id=o.external_order_id
     left join companies c on c.id=o.company_id
     where oi.product_id=$1
       and o.ordered_at >= $2::timestamptz
       and (cardinality($3::text[])=0 or ch.code=any($3::text[]))
       and o.order_status in ('confirmed','completed')
       and coalesce(o.fulfillment_status,'') <> 'returned'
       and lower(coalesce(fo.status,'')) !~ '(return|cancel|failed)'
       and lower(coalesce(oi.provider_status,'')) !~ '(return|cancel|failed)'
     group by o.id,o.external_order_number,o.ordered_at,ch.code,ch.name,
       coalesce(nullif(c.nombre_comercial,''),nullif(c.nombre,''),c.razon_social)
     order by o.ordered_at,o.id`,
    [product.id, since.toISOString(), channels],
  );

  const orders = salesResult.rows.map((row) => ({
    orderId: Number(row.order_id),
    orderNumber: row.external_order_number,
    orderedAt: row.ordered_at,
    channelCode: row.channel_code,
    channelName: row.channel_name,
    companyName: row.company_name,
    units: Number(row.units),
    total: Number(row.total),
  }));
  const byChannel = Object.values(orders.reduce((result, order) => {
    result[order.channelCode] ||= {
      channelCode: order.channelCode,
      channelName: order.channelName,
      ordersCount: 0,
      unitsSold: 0,
      revenue: 0,
    };
    result[order.channelCode].ordersCount += 1;
    result[order.channelCode].unitsSold += order.units;
    result[order.channelCode].revenue += order.total;
    return result;
  }, {}));

  console.log(JSON.stringify({
    sku: product.main_sku,
    productId: Number(product.id),
    name: product.name,
    sinceLima: sinceInput,
    sinceUtc: since.toISOString(),
    channels,
    stock: Number(product.quantity_on_hand),
    reserved: Number(product.quantity_reserved),
    ordersCount: orders.length,
    unitsSold: orders.reduce((sum, order) => sum + order.units, 0),
    revenue: orders.reduce((sum, order) => sum + order.total, 0),
    byChannel,
    orders,
  }));

  await client.query('rollback');
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  client.release();
  await pool.end();
}
