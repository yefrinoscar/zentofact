import { MARKETPLACE_RAW_IMAGE_SQL } from './item-image.js';
import { publishedListingCondition } from './product-service.js';
import { httpError, loadCore, positiveInt } from './utils.js';

const LIMA_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Lima',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const SETTLEMENT_SHARE = (field, saleId = 'settlement_sale_id') => `case
          when ${saleId} is null then null
          when coalesce(order_gross, 0) = 0 then 0
          else ${field} * (line_total / order_gross)
        end`;

const PRODUCT_SORTS = {
  product: 'min(name)',
  units: 'sum(units_sold)',
  orders: 'sum(orders_count)',
  grossSales: 'sum(revenue)',
  falabellaTake: 'sum(falabella_take)',
  arrives: 'sum(arrives)',
  sellers: 'count(distinct company_id)',
};

const PAYOUT_FILTERS = new Set(['all', 'paid', 'pending']);
export const TRACKED_BUYER_MIN_UNITS = 5;
const TRACKED_BUYER_LIMIT = 100;
const OTHER_BUYER_LIMIT = 20;

const ELIGIBLE_SALE = `o.order_status in ('confirmed','completed')
    and coalesce(o.fulfillment_status, '') not in ('returned','cancelled','failed')
    and lower(coalesce(fo.status, '')) !~ '(return|cancel|failed)'
    and lower(coalesce(oi.provider_status, '')) !~ '(return|cancel|failed)'
    and coalesce(oi.product_id, linked.product_id, listing.product_id) is not null
    and coalesce(linked.channel_code, listing.channel_code, ch.code) = 'falabella'`;

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

function optionalMoney(value, label) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0) throw httpError(`${label} inválido.`);
  return parsed;
}

function optionalPayout(value) {
  const payout = String(value || 'all').trim().toLowerCase();
  if (!PAYOUT_FILTERS.has(payout)) throw httpError('Filtro de pago inválido.');
  return payout;
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
    minGrossSales: optionalMoney(input.minGrossSales, 'minGrossSales'),
    minFalabellaTake: optionalMoney(input.minFalabellaTake, 'minFalabellaTake'),
    minArrives: optionalMoney(input.minArrives, 'minArrives'),
    payout: optionalPayout(input.payout),
    sortBy,
    sortDir,
    ...limitOffset(input),
  };
}

function productHavingSql(filters, values) {
  const having = ['true'];
  if (filters.minGrossSales != null) {
    values.push(filters.minGrossSales);
    having.push(`sum(revenue) >= $${values.length}`);
  }
  if (filters.minFalabellaTake != null) {
    values.push(filters.minFalabellaTake);
    having.push(`coalesce(sum(falabella_take), 0) >= $${values.length}`);
  }
  if (filters.minArrives != null) {
    values.push(filters.minArrives);
    having.push(`coalesce(sum(arrives), 0) >= $${values.length}`);
  }
  if (filters.payout === 'paid') having.push('coalesce(sum(paid_arrives), 0) > 0');
  if (filters.payout === 'pending') having.push('coalesce(sum(pending_arrives), 0) > 0');
  return having.join(' and ');
}

function productOrderSql(filters) {
  return `${PRODUCT_SORTS[filters.sortBy]} ${filters.sortDir} nulls last, min(name), min(sku)`;
}

const TAKE_RATE_SQL = `coalesce(
                 case
                   when pr.matched_gross > 0 and pr.matched_gross >= pr.gross * 0.1
                     then pr.matched_take / pr.matched_gross
                 end,
                 case when cr.matched_gross > 0 then cr.matched_take / cr.matched_gross end,
                 case when ovr.matched_gross > 0 then ovr.matched_take / ovr.matched_gross end,
                 0
               )`;

function moneyCtes() {
  return `product_rates as (
         select product_key,
           sum(line_total) as gross,
           coalesce(sum(line_total) filter (where settlement_sale_id is not null), 0) as matched_gross,
           coalesce(sum(allocated_take), 0) as matched_take
         from eligible
         group by 1
       ),
       company_rates as (
         select company_id,
           coalesce(sum(line_total) filter (where settlement_sale_id is not null), 0) as matched_gross,
           coalesce(sum(allocated_take), 0) as matched_take
         from eligible
         group by 1
       ),
       overall_rate as (
         select
           coalesce(sum(line_total) filter (where settlement_sale_id is not null), 0) as matched_gross,
           coalesce(sum(allocated_take), 0) as matched_take
         from eligible
       ),
       priced as (
         select
           base.*,
           base.line_take as falabella_take,
           base.line_arrives as arrives,
           case when base.settlement_status = 'paid' then coalesce(base.allocated_neto, 0) else 0 end as paid_arrives,
           base.line_arrives
             - case when base.settlement_status = 'paid' then coalesce(base.allocated_neto, 0) else 0 end
             as pending_arrives
         from (
           select e.*,
             coalesce(e.allocated_take, e.line_total * ${TAKE_RATE_SQL}) as line_take,
             coalesce(
               e.allocated_neto,
               e.line_total - coalesce(e.allocated_take, e.line_total * ${TAKE_RATE_SQL})
             ) as line_arrives
           from eligible e
           left join product_rates pr on pr.product_key = e.product_key
           left join company_rates cr on cr.company_id = e.company_id
           cross join overall_rate ovr
         ) base
       )`;
}

export function takeRateFromSamples({
  productGross = 0,
  productMatchedGross = 0,
  productMatchedTake = 0,
  companyMatchedGross = 0,
  companyMatchedTake = 0,
  overallMatchedGross = 0,
  overallMatchedTake = 0,
} = {}) {
  if (productMatchedGross > 0 && productMatchedGross >= productGross * 0.1) {
    return productMatchedTake / productMatchedGross;
  }
  if (companyMatchedGross > 0) return companyMatchedTake / companyMatchedGross;
  if (overallMatchedGross > 0) return overallMatchedTake / overallMatchedGross;
  return 0;
}

export function lineSaleMoney({
  lineTotal = 0,
  allocatedTake = null,
  allocatedNeto = null,
  paid = false,
  rate = 0,
} = {}) {
  const take = allocatedTake == null ? Number(lineTotal) * Number(rate || 0) : Number(allocatedTake);
  const arrives = allocatedNeto == null ? Number(lineTotal) - take : Number(allocatedNeto);
  const paidArrives = paid ? Number(allocatedNeto || 0) : 0;
  return {
    falabellaTake: take,
    arrives,
    paidArrives,
    pendingArrives: arrives - paidArrives,
  };
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
        raw.*,
        ${SETTLEMENT_SHARE('coalesce(settlement_commission, 0) + coalesce(settlement_other_fees, 0)')} as allocated_take,
        ${SETTLEMENT_SHARE('settlement_neto')} as allocated_neto
      from (
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
        sum(coalesce(oi.total, oi.unit_price * oi.quantity, 0)) over (partition by o.id) as order_gross,
        ss.sale_id as settlement_sale_id,
        ss.status as settlement_status,
        ss.commission as settlement_commission,
        ss.other_fees as settlement_other_fees,
        ss.neto as settlement_neto,
        coalesce(
          nullif(trim(o.customer->>'documentNumber'), ''),
          nullif(lower(trim(o.customer->>'email')), ''),
          nullif(trim(o.customer->>'name'), ''),
          'pedido:' || o.id::text
        ) as buyer_key,
        coalesce(nullif(trim(o.customer->>'name'), ''), 'Comprador sin nombre') as buyer_name,
        nullif(trim(o.customer->>'documentNumber'), '') as buyer_document,
        nullif(trim(o.customer->>'email'), '') as buyer_email,
        coalesce(
          nullif(trim(o.customer->>'phone'), ''),
          nullif(trim(fo.raw_data->>'CustomerPhone'), ''),
          nullif(trim(fo.raw_data->>'Phone'), '')
        ) as buyer_phone,
        o.ordered_at
      from order_items oi
      join orders o on o.id=oi.order_id
      left join falabella_orders fo
        on fo.company_id=o.company_id and fo.order_id=o.external_order_id
      left join sale_settlements ss
        on ss.sale_source='falabella_order' and ss.sale_id=fo.id
      left join companies c on c.id=o.company_id
      left join order_channel_accounts oca on oca.id=o.channel_account_id
      left join order_channels ch on ch.id=oca.channel_id
      left join product_listings linked on linked.id=oi.listing_id
      left join lateral (
        select l.product_id, l.title, l.seller_sku, l.shop_sku, l.metadata, l.channel_code
        from product_listings l
        where l.company_id=o.company_id
          and l.status='active'
          and l.channel_code='falabella'
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
      ) raw
    )`;
}

function settlementMoney(value, arrives) {
  if (arrives == null && value == null) return null;
  if (arrives != null) return Number(value || 0);
  return value == null ? null : Number(value);
}

function mapSeller(seller = {}) {
  const channelCodes = Array.isArray(seller.channelCodes)
    ? seller.channelCodes.filter(Boolean)
    : seller.channelCode ? [seller.channelCode] : [];
  const arrives = seller.arrives == null ? null : Number(seller.arrives);
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
    falabellaTake: seller.falabellaTake == null ? null : Number(seller.falabellaTake),
    arrives,
    paidArrives: settlementMoney(seller.paidArrives, arrives),
    pendingArrives: settlementMoney(seller.pendingArrives, arrives),
    visits: seller.visits == null ? null : Number(seller.visits),
  };
}

function mapProductRow(row = {}) {
  const arrives = row.arrives == null ? null : Number(row.arrives);
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
    falabellaTake: row.falabella_take == null ? null : Number(row.falabella_take),
    arrives,
    paidArrives: settlementMoney(row.paid_arrives, arrives),
    pendingArrives: settlementMoney(row.pending_arrives, arrives),
    visits: row.visits == null ? null : Number(row.visits),
    sellers: (Array.isArray(row.sellers) ? row.sellers : []).map(mapSeller),
  };
}

function mapBuyerCompany(company = {}) {
  return {
    companyId: company.companyId == null ? null : Number(company.companyId),
    companyName: company.companyName || null,
    unitsBought: Number(company.unitsBought || 0),
    ordersCount: Number(company.ordersCount || 0),
    grossSales: Number(company.grossSales || 0),
  };
}

function mapBuyerProduct(product = {}) {
  return {
    productKey: product.productKey || null,
    sku: product.sku || '',
    name: product.name || '',
    unitsBought: Number(product.unitsBought || 0),
    grossSales: Number(product.grossSales || 0),
  };
}

function mapBuyer(row = {}) {
  return {
    buyerKey: row.buyer_key,
    name: row.buyer_name,
    documentNumber: row.buyer_document || null,
    email: row.buyer_email || null,
    phone: row.buyer_phone || null,
    tracked: Number(row.units_bought || 0) > TRACKED_BUYER_MIN_UNITS,
    companies: (Array.isArray(row.companies) ? row.companies : []).map(mapBuyerCompany),
    products: (Array.isArray(row.products) ? row.products : []).map(mapBuyerProduct),
    ordersCount: Number(row.orders_count || 0),
    unitsBought: Number(row.units_bought || 0),
    grossSales: Number(row.revenue || 0),
    lastOrderedAt: row.last_ordered_at || null,
  };
}

function buyerDetailSql(eligibleCteSql, { tracked, limit }) {
  const unitClause = tracked
    ? `b.units_bought > ${TRACKED_BUYER_MIN_UNITS}`
    : `b.units_bought <= ${TRACKED_BUYER_MIN_UNITS}`;
  const orderSql = tracked
    ? 'b.units_bought desc, b.revenue desc, b.buyer_name'
    : 'b.revenue desc nulls last, b.buyer_name';
  return `with ${eligibleCteSql},
       buyer_stats as (
         select
           buyer_key,
           min(buyer_name) as buyer_name,
           min(buyer_document) as buyer_document,
           min(buyer_email) as buyer_email,
           min(buyer_phone) as buyer_phone,
           count(distinct order_id)::int as orders_count,
           coalesce(sum(quantity), 0) as units_bought,
           coalesce(sum(line_total), 0) as revenue,
           max(ordered_at) as last_ordered_at
         from eligible
         group by buyer_key
       ),
       buyer_companies as (
         select
           buyer_key,
           company_id,
           min(company_name) as company_name,
           coalesce(sum(quantity), 0) as units_bought,
           count(distinct order_id)::int as orders_count,
           coalesce(sum(line_total), 0) as revenue
         from eligible
         group by buyer_key, company_id
       ),
       buyer_products as (
         select
           buyer_key,
           product_key,
           min(sku) as sku,
           min(name) as name,
           coalesce(sum(quantity), 0) as units_bought,
           coalesce(sum(line_total), 0) as revenue
         from eligible
         group by buyer_key, product_key
       )
       select
         b.buyer_key,
         b.buyer_name,
         b.buyer_document,
         b.buyer_email,
         b.buyer_phone,
         b.orders_count,
         b.units_bought,
         b.revenue,
         b.last_ordered_at,
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'companyId', company_id,
             'companyName', company_name,
             'unitsBought', units_bought,
             'ordersCount', orders_count,
             'grossSales', revenue
           ) order by revenue desc, company_name)
           from buyer_companies c
           where c.buyer_key = b.buyer_key
         ), '[]'::jsonb) as companies,
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'productKey', product_key,
             'sku', sku,
             'name', name,
             'unitsBought', units_bought,
             'grossSales', revenue
           ) order by units_bought desc, name)
           from buyer_products p
           where p.buyer_key = b.buyer_key
         ), '[]'::jsonb) as products
       from buyer_stats b
       where ${unitClause}
       order by ${orderSql}
       limit ${Number(limit)}`;
}

export async function listProductSalesReport(input = {}, db) {
  const filters = parseProductSalesFilters(input);
  const target = db || (await loadCore()).pool;
  const overviewValues = [filters.from, filters.to];
  const overviewCte = eligibleCte(filters, overviewValues);
  const pageFilterValues = [filters.from, filters.to];
  const pageCte = eligibleCte(filters, pageFilterValues, { includeSearch: true });
  const pageHavingValues = [...pageFilterValues];
  const havingSql = productHavingSql(filters, pageHavingValues);
  const pageValues = [...pageHavingValues, filters.limit, filters.offset];

  const sellerPublishedSql = `bool_or(exists (
           select 1 from product_listings pub
           where pub.product_id=priced.product_id
             and pub.company_id=priced.company_id
             and ${publishedListingCondition('pub')}
         ))`;

  const [pageResult, pageCountResult, totalsResult, topProductsResult, trackedBuyersResult, otherBuyersResult] = await Promise.all([
    target.query(
      `with ${pageCte},
       ${moneyCtes()},
       seller_rows as (
         select product_key, product_id, sku, name, image_url, brand,
           company_id, company_name,
           sum(quantity) as units_sold,
           count(distinct order_id) as orders_count,
           sum(line_total) as revenue,
           sum(falabella_take) as falabella_take,
           sum(arrives) as arrives,
           sum(paid_arrives) as paid_arrives,
           sum(pending_arrives) as pending_arrives,
           ${sellerPublishedSql} as published,
           array_agg(distinct channel_code) filter (where channel_code is not null) as channel_codes,
           min(seller_title) as seller_title,
           min(seller_sku) as seller_sku,
           min(shop_sku) as shop_sku
         from priced
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
         sum(falabella_take) as falabella_take,
         sum(arrives) as arrives,
         sum(paid_arrives) as paid_arrives,
         sum(pending_arrives) as pending_arrives,
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
           'falabellaTake', falabella_take,
           'arrives', arrives,
           'paidArrives', paid_arrives,
           'pendingArrives', pending_arrives,
           'visits', null
         ) order by revenue desc, company_name) as sellers
       from seller_rows
       group by product_key
       having ${havingSql}
       order by ${productOrderSql(filters)}
       limit $${pageValues.length - 1} offset $${pageValues.length}`,
      pageValues,
    ),
    target.query(
      `with ${pageCte},
       ${moneyCtes()},
       seller_rows as (
         select product_key,
           sum(line_total) as revenue,
           sum(falabella_take) as falabella_take,
           sum(arrives) as arrives,
           sum(paid_arrives) as paid_arrives,
           sum(pending_arrives) as pending_arrives
         from priced
         group by 1
       )
       select count(*)::int as products_count
       from (
         select product_key
         from seller_rows
         group by product_key
         having ${havingSql}
       ) counted`,
      pageHavingValues,
    ),
    target.query(
      `with ${overviewCte},
       ${moneyCtes()}
       select
         count(distinct product_key)::int as products_count,
         coalesce(sum(quantity), 0) as units_sold,
         count(distinct order_id)::int as orders_count,
         count(distinct company_id)::int as sellers_count,
         count(distinct buyer_key)::int as buyers_count,
         coalesce(sum(line_total), 0) as gross_sales,
         coalesce(sum(falabella_take), 0) as falabella_take,
         coalesce(sum(arrives), 0) as arrives,
         coalesce(sum(paid_arrives), 0) as paid_arrives,
         coalesce(sum(pending_arrives), 0) as pending_arrives,
         count(distinct settlement_sale_id)::int as settlement_orders
       from priced`,
      overviewValues,
    ),
    target.query(
      `with ${overviewCte},
       ${moneyCtes()}
       select
         product_key,
         min(product_id) as product_id,
         min(sku) as sku,
         min(name) as name,
         min(image_url) as image_url,
         coalesce(sum(quantity), 0) as units_sold,
         count(distinct order_id)::int as orders_count,
         count(distinct company_id)::int as sellers_count,
         coalesce(sum(line_total), 0) as revenue,
         coalesce(sum(falabella_take), 0) as falabella_take,
         coalesce(sum(arrives), 0) as arrives,
         coalesce(sum(paid_arrives), 0) as paid_arrives,
         coalesce(sum(pending_arrives), 0) as pending_arrives
       from priced
       group by product_key
       order by revenue desc nulls last, min(name), min(sku)
       limit 5`,
      overviewValues,
    ),
    target.query(buyerDetailSql(overviewCte, { tracked: true, limit: TRACKED_BUYER_LIMIT }), overviewValues),
    target.query(buyerDetailSql(overviewCte, { tracked: false, limit: OTHER_BUYER_LIMIT }), overviewValues),
  ]);

  const totals = totalsResult.rows[0] || {};
  const unitsSold = Number(totals.units_sold || 0);
  const ordersCount = Number(totals.orders_count || 0);
  const grossSales = Number(totals.gross_sales || 0);
  const settlementOrders = Number(totals.settlement_orders || 0);
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
      falabellaTake: Number(totals.falabella_take || 0),
      arrives: Number(totals.arrives || 0),
      paidArrives: Number(totals.paid_arrives || 0),
      pendingArrives: Number(totals.pending_arrives || 0),
      settlementOrders,
      averageTicket: ordersCount > 0 ? grossSales / ordersCount : 0,
      visits: null,
    },
    topProducts: topProductsResult.rows.map(mapProductRow),
    trackedBuyers: trackedBuyersResult.rows.map(mapBuyer),
    topBuyers: otherBuyersResult.rows.map(mapBuyer),
    limit: filters.limit,
    offset: filters.offset,
  };
}
