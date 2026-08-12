import {
  finiteNumber,
  httpError,
  inTransaction,
  jsonObject,
  loadCore,
  mapListing,
  mapProduct,
  positiveInt,
  text,
} from './utils.js';

const PRODUCT_STATUSES = ['active', 'inactive', 'archived'];

function productStatus(value, fallback = 'active') {
  const normalized = String(value ?? fallback).trim().toLowerCase();
  if (!PRODUCT_STATUSES.includes(normalized)) throw httpError('status inválido.');
  return normalized;
}

function limitOffset(input = {}) {
  const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
  const offset = Math.max(Number(input.offset) || 0, 0);
  return { limit, offset };
}

export async function listProducts(filters = {}, db) {
  const target = db || (await loadCore()).pool;
  const values = [];
  const where = [];
  const { limit, offset } = limitOffset(filters);
  const search = String(filters.search || '').trim();
  if (search) {
    values.push(`%${search}%`);
    where.push(`(
      p.main_sku ilike $${values.length}
      or p.name ilike $${values.length}
      or p.brand ilike $${values.length}
      or exists (
        select 1 from product_listings search_listing
        where search_listing.product_id=p.id
          and (search_listing.seller_sku ilike $${values.length}
            or search_listing.shop_sku ilike $${values.length})
      )
    )`);
  }
  if (filters.status && filters.status !== 'all') {
    values.push(productStatus(filters.status));
    where.push(`p.status=$${values.length}`);
  } else if (filters.includeArchived !== 'true' && filters.includeArchived !== true) {
    where.push(`p.status <> 'archived'`);
  }
  if (filters.channelCode && filters.channelCode !== 'all') {
    values.push(String(filters.channelCode).trim().toLowerCase());
    where.push(`exists (
      select 1 from product_listings channel_listing
      where channel_listing.product_id=p.id and channel_listing.channel_code=$${values.length}
        and channel_listing.status='active'
    )`);
  }
  if (filters.lowStock === 'true' || filters.lowStock === true) {
    where.push(`i.reorder_point is not null and i.quantity_on_hand - i.quantity_reserved <= i.reorder_point`);
  }
  if (filters.companyId) {
    values.push(positiveInt(filters.companyId, 'companyId'));
    where.push(`exists (
      select 1 from product_listings company_listing
      where company_listing.product_id=p.id and company_listing.company_id=$${values.length}
        and company_listing.status='active'
    )`);
  }
  const sellerCoverage = String(filters.sellerCoverage || 'all').trim().toLowerCase();
  if (!['all', 'single', 'multiple'].includes(sellerCoverage)) throw httpError('sellerCoverage inválido.');
  if (sellerCoverage !== 'all') {
    where.push(`(
      select count(distinct coverage_listing.company_id)
      from product_listings coverage_listing
      where coverage_listing.product_id=p.id and coverage_listing.status='active'
    ) ${sellerCoverage === 'single' ? '= 1' : '> 1'}`);
  }
  const clause = where.length ? `where ${where.join(' and ')}` : '';
  values.push(limit, offset);
  const result = await target.query(
    `select page.*,
       listing_stats.listings_count,
       listing_stats.sellers_count,
       listing_stats.channels,
       listing_stats.seller_price_min,
       listing_stats.seller_price_max,
       listing_stats.seller_stock_total
     from (
       select p.*, i.quantity_on_hand, i.quantity_reserved, i.reorder_point,
         i.quantity_on_hand - i.quantity_reserved as available,
         count(*) over() as total_count
       from products p
       join product_inventory i on i.product_id=p.id
       ${clause}
       order by p.updated_at desc, p.id desc
       limit $${values.length - 1} offset $${values.length}
     ) page
     cross join lateral (
       select
         count(l.id) filter (where l.status='active') as listings_count,
         count(distinct l.company_id) filter (where l.status='active') as sellers_count,
         coalesce(array_agg(distinct l.channel_code) filter (where l.status='active'), '{}') as channels,
         min((coalesce(l.metadata->>'effectivePrice', l.metadata->>'price'))::numeric)
           filter (where l.status='active' and coalesce(l.metadata->>'effectivePrice', l.metadata->>'price') ~ '^[0-9]+([.][0-9]+)?$') as seller_price_min,
         max((coalesce(l.metadata->>'effectivePrice', l.metadata->>'price'))::numeric)
           filter (where l.status='active' and coalesce(l.metadata->>'effectivePrice', l.metadata->>'price') ~ '^[0-9]+([.][0-9]+)?$') as seller_price_max,
         coalesce(sum(l.marketplace_quantity) filter (where l.status='active'), 0) as seller_stock_total
       from product_listings l
       where l.product_id=page.id
     ) listing_stats
     order by page.updated_at desc, page.id desc`,
    values,
  );
  return {
    products: result.rows.map(mapProduct),
    totalCount: result.rows[0] ? Number(result.rows[0].total_count) : 0,
    limit,
    offset,
  };
}

export async function getProduct(id, db) {
  const target = db || (await loadCore()).pool;
  const productId = positiveInt(id, 'productId');
  const [productResult, listingsResult] = await Promise.all([
    target.query(
      `select p.*, i.quantity_on_hand, i.quantity_reserved, i.reorder_point,
         i.quantity_on_hand - i.quantity_reserved as available,
         listing_stats.listings_count,
         listing_stats.sellers_count,
         listing_stats.channels,
         listing_stats.seller_price_min,
         listing_stats.seller_price_max,
         listing_stats.seller_stock_total
       from products p
       join product_inventory i on i.product_id=p.id
       cross join lateral (
         select
           count(l.id) filter (where l.status='active') as listings_count,
           count(distinct l.company_id) filter (where l.status='active') as sellers_count,
           coalesce(array_agg(distinct l.channel_code) filter (where l.status='active'), '{}') as channels,
           min((coalesce(l.metadata->>'effectivePrice', l.metadata->>'price'))::numeric)
             filter (where l.status='active' and coalesce(l.metadata->>'effectivePrice', l.metadata->>'price') ~ '^[0-9]+([.][0-9]+)?$') as seller_price_min,
           max((coalesce(l.metadata->>'effectivePrice', l.metadata->>'price'))::numeric)
             filter (where l.status='active' and coalesce(l.metadata->>'effectivePrice', l.metadata->>'price') ~ '^[0-9]+([.][0-9]+)?$') as seller_price_max,
           coalesce(sum(l.marketplace_quantity) filter (where l.status='active'), 0) as seller_stock_total
         from product_listings l
         where l.product_id=p.id
       ) listing_stats
       where p.id=$1`,
      [productId],
    ),
    target.query(
      `select l.*, coalesce(nullif(c.nombre_comercial, ''), nullif(c.nombre, ''), c.razon_social) as company_name
       from product_listings l join companies c on c.id=l.company_id
       where l.product_id=$1 order by l.status='active' desc, l.channel_code, company_name, l.id`,
      [productId],
    ),
  ]);
  const product = mapProduct(productResult.rows[0]);
  return product ? { ...product, listings: listingsResult.rows.map(mapListing) } : null;
}

export async function getProductSales(id, filters = {}, db) {
  const target = db || (await loadCore()).pool;
  const productId = positiveInt(id, 'productId');
  const range = String(filters.range || '30').trim().toLowerCase();
  if (!['30', '90', '365', 'all'].includes(range)) throw httpError('range inválido.');
  const values = [productId];
  const dateClause = range === 'all'
    ? ''
    : (values.push(Number(range)), `and o.ordered_at >= now() - ($${values.length} * interval '1 day')`);
  const eligibleClause = `o.order_status in ('confirmed','completed')
    and coalesce(o.fulfillment_status, '') <> 'returned'
    and lower(coalesce(fo.status, '')) !~ '(return|cancel|failed)'
    and lower(coalesce(oi.provider_status, '')) !~ '(return|cancel|failed)'`;
  const [summaryResult, dailyResult, recentResult] = await Promise.all([
    target.query(
      `select
         count(distinct o.id) as orders_count,
         coalesce(sum(oi.quantity), 0) as units_sold,
         coalesce(sum(coalesce(oi.total, oi.unit_price * oi.quantity, 0)), 0) as revenue,
         coalesce(
           sum(coalesce(oi.total, oi.unit_price * oi.quantity, 0))
             / nullif(sum(oi.quantity), 0),
           0
         ) as average_unit_price,
         min(o.ordered_at) as first_sale_at,
         max(o.ordered_at) as last_sale_at
       from order_items oi
       join orders o on o.id=oi.order_id
       left join falabella_orders fo
         on fo.company_id=o.company_id and fo.order_id=o.external_order_id
       where oi.product_id=$1 and ${eligibleClause} ${dateClause}`,
      values,
    ),
    target.query(
      `select date_trunc('day', o.ordered_at) as day,
         count(distinct o.id) as orders_count,
         coalesce(sum(oi.quantity), 0) as units_sold,
         coalesce(sum(coalesce(oi.total, oi.unit_price * oi.quantity, 0)), 0) as revenue
       from order_items oi
       join orders o on o.id=oi.order_id
       left join falabella_orders fo
         on fo.company_id=o.company_id and fo.order_id=o.external_order_id
       where oi.product_id=$1 and ${eligibleClause} ${dateClause}
       group by 1 order by 1`,
      values,
    ),
    target.query(
      `select o.id as order_id, o.external_order_number, o.ordered_at, o.company_id,
         coalesce(nullif(c.nombre_comercial, ''), nullif(c.nombre, ''), c.razon_social) as company_name,
         coalesce(sum(oi.quantity), 0) as quantity,
         coalesce(
           sum(coalesce(oi.total, oi.unit_price * oi.quantity, 0))
             / nullif(sum(oi.quantity), 0),
           0
         ) as unit_price,
         coalesce(sum(coalesce(oi.total, oi.unit_price * oi.quantity, 0)), 0) as total
       from order_items oi
       join orders o on o.id=oi.order_id
       left join falabella_orders fo
         on fo.company_id=o.company_id and fo.order_id=o.external_order_id
       left join companies c on c.id=o.company_id
       where oi.product_id=$1 and ${eligibleClause} ${dateClause}
       group by o.id, o.external_order_number, o.ordered_at, o.company_id,
         coalesce(nullif(c.nombre_comercial, ''), nullif(c.nombre, ''), c.razon_social)
       order by o.ordered_at desc nulls last, o.id desc limit 20`,
      values,
    ),
  ]);
  const summary = summaryResult.rows[0] || {};
  return {
    range,
    summary: {
      ordersCount: Number(summary.orders_count || 0),
      unitsSold: Number(summary.units_sold || 0),
      revenue: Number(summary.revenue || 0),
      averageUnitPrice: Number(summary.average_unit_price || 0),
      firstSaleAt: summary.first_sale_at || null,
      lastSaleAt: summary.last_sale_at || null,
    },
    daily: dailyResult.rows.map((row) => ({
      day: row.day,
      ordersCount: Number(row.orders_count || 0),
      unitsSold: Number(row.units_sold || 0),
      revenue: Number(row.revenue || 0),
    })),
    recent: recentResult.rows.map((row) => ({
      orderId: Number(row.order_id),
      orderNumber: row.external_order_number,
      orderedAt: row.ordered_at,
      companyId: row.company_id == null ? null : Number(row.company_id),
      companyName: row.company_name,
      quantity: Number(row.quantity || 0),
      unitPrice: Number(row.unit_price || 0),
      total: Number(row.total || 0),
    })),
  };
}

export async function getProductReturns(id, filters = {}, db) {
  const target = db || (await loadCore()).pool;
  const productId = positiveInt(id, 'productId');
  const range = String(filters.range || '30').trim().toLowerCase();
  if (!['30', '90', '365', 'all'].includes(range)) throw httpError('range inválido.');
  const values = [productId];
  const dateClause = range === 'all'
    ? ''
    : (values.push(Number(range)), `and o.ordered_at >= now() - ($${values.length} * interval '1 day')`);
  const returnedClause = `o.order_status not in ('cancelled','failed')
    and (
      o.fulfillment_status='returned'
      or lower(coalesce(fo.status, '')) ~ '(return)'
      or lower(coalesce(oi.provider_status, '')) ~ '(return)'
    )`;
  const [summaryResult, recentResult] = await Promise.all([
    target.query(
      `select
         count(distinct o.id) filter (where ${returnedClause}) as orders_count,
         count(distinct o.company_id) filter (where ${returnedClause}) as sellers_count,
         coalesce(sum(oi.quantity) filter (where ${returnedClause}), 0) as units_returned,
         coalesce(sum(coalesce(oi.total, oi.unit_price * oi.quantity, 0)) filter (where ${returnedClause}), 0) as amount
       from order_items oi
       join orders o on o.id=oi.order_id
       left join falabella_orders fo
         on fo.company_id=o.company_id and fo.order_id=o.external_order_id
       where oi.product_id=$1 ${dateClause}`,
      values,
    ),
    target.query(
      `select o.id as order_id, o.external_order_number, o.ordered_at, o.company_id,
         coalesce(nullif(c.nombre_comercial, ''), nullif(c.nombre, ''), c.razon_social) as company_name,
         coalesce(sum(oi.quantity), 0) as quantity,
         coalesce(sum(coalesce(oi.total, oi.unit_price * oi.quantity, 0)), 0) as amount,
         nullif(string_agg(distinct coalesce(
           nullif(oi.raw_data->>'ReasonDetail', ''),
           nullif(oi.raw_data->>'Reason', '')
         ), ' · '), '') as reason
       from order_items oi
       join orders o on o.id=oi.order_id
       left join falabella_orders fo
         on fo.company_id=o.company_id and fo.order_id=o.external_order_id
       left join companies c on c.id=o.company_id
       where oi.product_id=$1 and ${returnedClause} ${dateClause}
       group by o.id, o.external_order_number, o.ordered_at, o.company_id,
         coalesce(nullif(c.nombre_comercial, ''), nullif(c.nombre, ''), c.razon_social)
       order by o.ordered_at desc nulls last, o.id desc limit 20`,
      values,
    ),
  ]);
  const summary = summaryResult.rows[0] || {};
  const unitsReturned = Number(summary.units_returned || 0);
  return {
    range,
    summary: {
      ordersCount: Number(summary.orders_count || 0),
      sellersCount: Number(summary.sellers_count || 0),
      unitsReturned,
      amount: Number(summary.amount || 0),
    },
    recent: recentResult.rows.map((row) => ({
      orderId: Number(row.order_id),
      orderNumber: row.external_order_number,
      orderedAt: row.ordered_at,
      companyId: row.company_id == null ? null : Number(row.company_id),
      companyName: row.company_name,
      quantity: Number(row.quantity || 0),
      amount: Number(row.amount || 0),
      reason: row.reason || null,
    })),
  };
}

export async function createProduct(input, actorUserId, db) {
  return inTransaction(db, async (client) => {
    const mainSku = text(input.mainSku, 'mainSku', 64).toUpperCase();
    const name = text(input.name, 'name', 300);
    let result;
    try {
      result = await client.query(
        `insert into products (
           main_sku, name, description, brand, status, attributes, barcode,
           image_url, reference_price, created_by, updated_by
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
         returning *`,
        [
          mainSku,
          name,
          text(input.description, 'description', 10000, { nullable: true }),
          text(input.brand, 'brand', 200, { nullable: true }),
          productStatus(input.status),
          JSON.stringify(jsonObject(input.attributes)),
          text(input.barcode, 'barcode', 200, { nullable: true }),
          text(input.imageUrl, 'imageUrl', 2000, { nullable: true }),
          finiteNumber(input.referencePrice, 'referencePrice', { nullable: true }),
          actorUserId ? String(actorUserId) : null,
        ],
      );
    } catch (error) {
      if (error?.code === '23505') throw httpError(`Ya existe un producto con mainSku ${mainSku}.`, 409, 'duplicate_main_sku');
      throw error;
    }
    await client.query(
      `insert into product_inventory (product_id, quantity_on_hand, quantity_reserved)
       values ($1,0,0) on conflict (product_id) do nothing`,
      [result.rows[0].id],
    );
    return getProduct(result.rows[0].id, client);
  });
}

export async function updateProduct(id, input, actorUserId, db) {
  const target = db || (await loadCore()).pool;
  const productId = positiveInt(id, 'productId');
  const fields = [];
  const values = [];
  const add = (column, value) => {
    values.push(value);
    fields.push(`${column}=$${values.length}`);
  };
  if (input.mainSku !== undefined) add('main_sku', text(input.mainSku, 'mainSku', 64).toUpperCase());
  if (input.name !== undefined) add('name', text(input.name, 'name', 300));
  if (input.description !== undefined) add('description', text(input.description, 'description', 10000, { nullable: true }));
  if (input.brand !== undefined) add('brand', text(input.brand, 'brand', 200, { nullable: true }));
  if (input.status !== undefined) add('status', productStatus(input.status));
  if (input.attributes !== undefined) add('attributes', JSON.stringify(jsonObject(input.attributes)));
  if (input.barcode !== undefined) add('barcode', text(input.barcode, 'barcode', 200, { nullable: true }));
  if (input.imageUrl !== undefined) add('image_url', text(input.imageUrl, 'imageUrl', 2000, { nullable: true }));
  if (input.referencePrice !== undefined) add('reference_price', finiteNumber(input.referencePrice, 'referencePrice', { nullable: true }));
  if (!fields.length) return getProduct(productId, target);
  add('updated_by', actorUserId ? String(actorUserId) : null);
  values.push(productId);
  try {
    const result = await target.query(
      `update products set ${fields.join(', ')}, updated_at=now() where id=$${values.length} returning id`,
      values,
    );
    if (!result.rows.length) throw httpError('Producto no encontrado.', 404);
  } catch (error) {
    if (error?.code === '23505') throw httpError('El mainSku ya está en uso.', 409, 'duplicate_main_sku');
    throw error;
  }
  return getProduct(productId, target);
}

export function archiveProduct(id, actorUserId, db) {
  return updateProduct(id, { status: 'archived' }, actorUserId, db);
}
