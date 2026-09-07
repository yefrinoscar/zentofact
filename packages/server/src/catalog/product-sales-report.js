import { MARKETPLACE_RAW_IMAGE_SQL } from './item-image.js';
import { publishedListingCondition } from './product-service.js';
import { httpError, loadCore, positiveInt } from './utils.js';

const LIMA_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Lima',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const PRODUCT_SORTS = {
  product: 'min(name)',
  units: 'sum(units_sold)',
  orders: 'sum(orders_count)',
  grossSales: 'sum(revenue)',
  sellers: 'count(distinct company_id)',
};

const ELIGIBLE_SALE = `o.order_status in ('confirmed','completed')
    and coalesce(o.fulfillment_status, '') not in ('returned','cancelled','failed')
    and lower(coalesce(fo.status, '')) !~ '(return|cancel|failed)'
    and lower(coalesce(oi.provider_status, '')) !~ '(return|cancel|failed)'`;

function limaToday() {
  return LIMA_DATE.format(new Date());
}

function parseDate(value, fallback) {
  const normalized = String(value || fallback || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw httpError('Fecha inválida.');
  const date = new Date(`${normalized}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw httpError('Fecha inválida.');
  }
  if (normalized > limaToday()) throw httpError('La fecha no puede ser futura.');
  return normalized;
}

function addDays(value, amount) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function diffDays(from, to) {
  const start = new Date(`${from}T12:00:00.000Z`).getTime();
  const end = new Date(`${to}T12:00:00.000Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}

function optionalPositiveInt(value, label) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  return positiveInt(value, label);
}

function limitOffset(input = {}) {
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 100);
  const offset = Math.max(Number(input.offset) || 0, 0);
  return { limit, offset };
}

export function parseProductSalesFilters(input = {}) {
  const to = parseDate(input.to, limaToday());
  const from = parseDate(input.from, addDays(to, -29));
  const span = diffDays(from, to);
  if (span < 0) throw httpError('La fecha inicial no puede ser posterior a la final.');
  if (span > 730) throw httpError('El reporte admite periodos de hasta 731 días.');
  const sortBy = String(input.sortBy || 'grossSales').trim();
  if (!Object.hasOwn(PRODUCT_SORTS, sortBy)) throw httpError('sortBy inválido.');
  const sortDir = String(input.sortDir || 'desc').trim().toLowerCase();
  if (!['asc', 'desc'].includes(sortDir)) throw httpError('sortDir inválido.');
  return {
    from,
    to,
    companyId: optionalPositiveInt(input.companyId, 'companyId'),
    search: String(input.search || '').trim(),
    sortBy,
    sortDir,
    ...limitOffset(input),
  };
}

function productOrderSql(filters) {
  return `${PRODUCT_SORTS[filters.sortBy]} ${filters.sortDir} nulls last, min(name), min(sku)`;
}

function eligibleCte(filters, values, { includeSearch = false } = {}) {
  const where = [
    ELIGIBLE_SALE,
    `(o.ordered_at at time zone 'America/Lima')::date between $1::date and $2::date`,
  ];
  if (filters.companyId) {
    values.push(filters.companyId);
    where.push(`o.company_id=$${values.length}`);
  }
  if (includeSearch && filters.search) {
    values.push(`%${filters.search}%`);
    where.push(`(
      p.main_sku ilike $${values.length}
      or p.name ilike $${values.length}
      or listing.title ilike $${values.length}
      or listing.seller_sku ilike $${values.length}
      or listing.shop_sku ilike $${values.length}
      or oi.sku ilike $${values.length}
      or oi.provider_sku ilike $${values.length}
      or oi.main_sku ilike $${values.length}
      or oi.description ilike $${values.length}
      or coalesce(nullif(trim(o.customer->>'name'), ''), '') ilike $${values.length}
      or exists (
        select 1 from product_listings search_listing
        where search_listing.product_id=coalesce(oi.product_id, linked.product_id, listing.product_id)
          and search_listing.status='active'
          and (
            search_listing.title ilike $${values.length}
            or search_listing.seller_sku ilike $${values.length}
            or search_listing.shop_sku ilike $${values.length}
          )
      )
    )`);
  }
  return `eligible as (
      select
        case
          when coalesce(oi.product_id, linked.product_id, listing.product_id) is not null
            then 'p:' || coalesce(oi.product_id, linked.product_id, listing.product_id)::text
          else 's:' || lower(coalesce(nullif(trim(oi.sku), ''), nullif(trim(oi.provider_sku), ''), 'sin-sku'))
        end as product_key,
        coalesce(oi.product_id, linked.product_id, listing.product_id) as product_id,
        coalesce(nullif(p.main_sku, ''), nullif(oi.main_sku, ''), nullif(oi.sku, ''), nullif(oi.provider_sku, ''), 'SIN-SKU') as sku,
        coalesce(nullif(p.name, ''), nullif(linked.title, ''), nullif(listing.title, ''), nullif(oi.description, ''), nullif(oi.sku, ''), 'Producto sin nombre') as name,
        coalesce(
          nullif(p.image_url, ''),
          nullif(listing.metadata->>'imageUrl', ''),
          nullif(linked.metadata->>'imageUrl', ''),
          ${MARKETPLACE_RAW_IMAGE_SQL}
        ) as image_url,
        p.brand,
        o.id as order_id,
        o.company_id,
        coalesce(nullif(c.nombre_comercial, ''), nullif(c.nombre, ''), c.razon_social) as company_name,
        coalesce(linked.channel_code, listing.channel_code, ch.code, 'manual') as channel_code,
        coalesce(nullif(linked.title, ''), nullif(listing.title, ''), nullif(oi.description, '')) as seller_title,
        coalesce(nullif(linked.seller_sku, ''), nullif(listing.seller_sku, ''), nullif(oi.sku, ''), nullif(oi.provider_sku, '')) as seller_sku,
        coalesce(nullif(linked.shop_sku, ''), nullif(listing.shop_sku, ''), nullif(oi.provider_sku, '')) as shop_sku,
        oi.quantity,
        coalesce(oi.total, oi.unit_price * oi.quantity, 0) as line_total,
        coalesce(
          nullif(trim(o.customer->>'documentNumber'), ''),
          nullif(lower(trim(o.customer->>'email')), ''),
          nullif(trim(o.customer->>'name'), ''),
          'pedido:' || o.id::text
        ) as buyer_key,
        coalesce(nullif(trim(o.customer->>'name'), ''), 'Comprador sin nombre') as buyer_name,
        nullif(trim(o.customer->>'documentNumber'), '') as buyer_document,
        nullif(trim(o.customer->>'email'), '') as buyer_email,
        o.ordered_at
      from order_items oi
      join orders o on o.id=oi.order_id
      left join falabella_orders fo
        on fo.company_id=o.company_id and fo.order_id=o.external_order_id
      left join companies c on c.id=o.company_id
      left join order_channel_accounts oca on oca.id=o.channel_account_id
      left join order_channels ch on ch.id=oca.channel_id
      left join product_listings linked on linked.id=oi.listing_id
      left join lateral (
        select l.product_id, l.title, l.seller_sku, l.shop_sku, l.metadata, l.channel_code
        from product_listings l
        where l.company_id=o.company_id
          and l.status='active'
          and (
            (nullif(trim(oi.sku), '') is not null and l.seller_sku=oi.sku)
            or (nullif(trim(oi.provider_sku), '') is not null and l.shop_sku=oi.provider_sku)
            or (nullif(trim(oi.sku), '') is not null and l.shop_sku=oi.sku)
            or (
              nullif(trim(oi.description), '') is not null
              and lower(l.title)=lower(oi.description)
            )
          )
        order by
          case
            when nullif(trim(oi.sku), '') is not null and l.seller_sku=oi.sku then 0
            when nullif(trim(oi.provider_sku), '') is not null and l.shop_sku=oi.provider_sku then 1
            when nullif(trim(oi.sku), '') is not null and l.shop_sku=oi.sku then 2
            else 3
          end,
          l.id
        limit 1
      ) listing on true
      left join products p on p.id=coalesce(oi.product_id, linked.product_id, listing.product_id)
      where ${where.join(' and ')}
    )`;
}

function mapSeller(seller = {}) {
  const channelCodes = Array.isArray(seller.channelCodes)
    ? seller.channelCodes.filter(Boolean)
    : seller.channelCode ? [seller.channelCode] : [];
  return {
    companyId: seller.companyId == null ? null : Number(seller.companyId),
    companyName: seller.companyName || null,
    channelCode: channelCodes[0] || null,
    channelCodes,
    title: seller.title || null,
    sellerSku: seller.sellerSku || null,
    shopSku: seller.shopSku || null,
    published: Boolean(seller.published),
    unitsSold: Number(seller.unitsSold || 0),
    ordersCount: Number(seller.ordersCount || 0),
    grossSales: Number(seller.grossSales || 0),
    visits: seller.visits == null ? null : Number(seller.visits),
  };
}

function mapProductRow(row = {}) {
  return {
    productKey: row.product_key,
    productId: row.product_id == null ? null : Number(row.product_id),
    sku: row.sku,
    name: row.name,
    imageUrl: row.image_url || null,
    brand: row.brand || null,
    mapped: row.product_id != null,
    published: Boolean(row.published),
    unitsSold: Number(row.units_sold || 0),
    ordersCount: Number(row.orders_count || 0),
    sellersCount: Number(row.sellers_count || 0),
    grossSales: Number(row.revenue || 0),
    visits: row.visits == null ? null : Number(row.visits),
    sellers: (Array.isArray(row.sellers) ? row.sellers : []).map(mapSeller),
  };
}

function mapBuyer(row = {}) {
  return {
    buyerKey: row.buyer_key,
    name: row.buyer_name,
    documentNumber: row.buyer_document || null,
    email: row.buyer_email || null,
    ordersCount: Number(row.orders_count || 0),
    unitsBought: Number(row.units_bought || 0),
    grossSales: Number(row.revenue || 0),
    lastOrderedAt: row.last_ordered_at || null,
  };
}

export async function listProductSalesReport(input = {}, db) {
  const filters = parseProductSalesFilters(input);
  const target = db || (await loadCore()).pool;
  const overviewValues = [filters.from, filters.to];
  const overviewCte = eligibleCte(filters, overviewValues);
  const pageFilterValues = [filters.from, filters.to];
  const pageCte = eligibleCte(filters, pageFilterValues, { includeSearch: true });
  const pageValues = [...pageFilterValues, filters.limit, filters.offset];

  const sellerPublishedSql = `bool_or(exists (
           select 1 from product_listings pub
           where pub.product_id=eligible.product_id
             and pub.company_id=eligible.company_id
             and ${publishedListingCondition('pub')}
         ))`;

  const [pageResult, pageCountResult, totalsResult, topProductsResult, topBuyersResult] = await Promise.all([
    target.query(
      `with ${pageCte},
       seller_rows as (
         select product_key, product_id, sku, name, image_url, brand,
           company_id, company_name,
           sum(quantity) as units_sold,
           count(distinct order_id) as orders_count,
           sum(line_total) as revenue,
           ${sellerPublishedSql} as published,
           array_agg(distinct channel_code) filter (where channel_code is not null) as channel_codes,
           min(seller_title) as seller_title,
           min(seller_sku) as seller_sku,
           min(shop_sku) as shop_sku
         from eligible
         group by 1,2,3,4,5,6,7,8
       )
       select
         product_key,
         min(product_id) as product_id,
         min(sku) as sku,
         min(name) as name,
         min(image_url) as image_url,
         min(brand) as brand,
         bool_or(published) as published,
         sum(units_sold) as units_sold,
         sum(orders_count) as orders_count,
         count(distinct company_id)::int as sellers_count,
         sum(revenue) as revenue,
         null::numeric as visits,
         jsonb_agg(jsonb_build_object(
           'companyId', company_id,
           'companyName', company_name,
           'channelCode', channel_codes[1],
           'channelCodes', to_jsonb(channel_codes),
           'title', seller_title,
           'sellerSku', seller_sku,
           'shopSku', shop_sku,
           'published', published,
           'unitsSold', units_sold,
           'ordersCount', orders_count,
           'grossSales', revenue,
           'visits', null
         ) order by revenue desc, company_name) as sellers
       from seller_rows
       group by product_key
       order by ${productOrderSql(filters)}
       limit $${pageValues.length - 1} offset $${pageValues.length}`,
      pageValues,
    ),
    target.query(
      `with ${pageCte}
       select count(distinct product_key)::int as products_count from eligible`,
      pageFilterValues,
    ),
    target.query(
      `with ${overviewCte}
       select
         count(distinct product_key)::int as products_count,
         coalesce(sum(quantity), 0) as units_sold,
         count(distinct order_id)::int as orders_count,
         count(distinct company_id)::int as sellers_count,
         count(distinct buyer_key)::int as buyers_count,
         coalesce(sum(line_total), 0) as gross_sales
       from eligible`,
      overviewValues,
    ),
    target.query(
      `with ${overviewCte}
       select
         product_key,
         min(product_id) as product_id,
         min(sku) as sku,
         min(name) as name,
         min(image_url) as image_url,
         coalesce(sum(quantity), 0) as units_sold,
         count(distinct order_id)::int as orders_count,
         count(distinct company_id)::int as sellers_count,
         coalesce(sum(line_total), 0) as revenue
       from eligible
       group by product_key
       order by revenue desc nulls last, min(name), min(sku)
       limit 5`,
      overviewValues,
    ),
    target.query(
      `with ${overviewCte}
       select
         buyer_key,
         min(buyer_name) as buyer_name,
         min(buyer_document) as buyer_document,
         min(buyer_email) as buyer_email,
         count(distinct order_id)::int as orders_count,
         coalesce(sum(quantity), 0) as units_bought,
         coalesce(sum(line_total), 0) as revenue,
         max(ordered_at) as last_ordered_at
       from eligible
       group by buyer_key
       order by revenue desc nulls last, min(buyer_name)
       limit 8`,
      overviewValues,
    ),
  ]);

  const totals = totalsResult.rows[0] || {};
  const unitsSold = Number(totals.units_sold || 0);
  const ordersCount = Number(totals.orders_count || 0);
  const grossSales = Number(totals.gross_sales || 0);
  return {
    from: filters.from,
    to: filters.to,
    timezone: 'America/Lima',
    products: pageResult.rows.map(mapProductRow),
    totalCount: Number(pageCountResult.rows[0]?.products_count || 0),
    totals: {
      productsCount: Number(totals.products_count || 0),
      unitsSold,
      ordersCount,
      sellersCount: Number(totals.sellers_count || 0),
      buyersCount: Number(totals.buyers_count || 0),
      grossSales,
      averageTicket: ordersCount > 0 ? grossSales / ordersCount : 0,
      visits: null,
    },
    topProducts: topProductsResult.rows.map(mapProductRow),
    topBuyers: topBuyersResult.rows.map(mapBuyer),
    limit: filters.limit,
    offset: filters.offset,
  };
}
