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
const SELLER_COVERAGES = ['all', 'none', 'single', 'multiple'];
const INVENTORY_STATUSES = ['all', 'inStock', 'lowStock', 'outOfStock'];
const PUBLICATION_STATUSES = ['all', 'published', 'unpublished'];
const SPECIAL_FILTERS = ['none', 'outOfStock', 'unpublished', 'lowStock'];
const CATALOG_SORTS = {
  updatedAt: { catalog: 'p.updated_at', page: 'page.updated_at' },
  name: { catalog: 'lower(p.name)', page: 'lower(page.name)' },
  available: { catalog: '(i.quantity_on_hand - i.quantity_reserved)', page: 'page.available' },
  sellerStock: {
    catalog: 'listing_stats.seller_stock_total',
    page: 'listing_stats.seller_stock_total',
    requiresListingStats: true,
  },
  sellers: {
    catalog: 'listing_stats.sellers_count',
    page: 'listing_stats.sellers_count',
    requiresListingStats: true,
  },
};
const LIMA_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Lima',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function limaToday() {
  return LIMA_DATE.format(new Date());
}

export function limaDate(value) {
  const today = limaToday();
  const date = String(value || today).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T12:00:00`).getTime())) {
    throw httpError('date inválida.');
  }
  if (date > today) throw httpError('date no puede ser futura.');
  return date;
}

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

function sellerCountSql() {
  return `(
    select count(distinct coverage_listing.company_id)
    from product_listings coverage_listing
    where coverage_listing.product_id=p.id and coverage_listing.status='active'
  )`;
}

function sellerStockSql() {
  return `(
    select coalesce(sum(stock_listing.marketplace_quantity), 0)
    from product_listings stock_listing
    where stock_listing.product_id=p.id and stock_listing.status='active'
  )`;
}

function lowStockSql() {
  return 'i.reorder_point is not null and i.quantity_on_hand - i.quantity_reserved <= i.reorder_point';
}

function inventoryStatusSql(status) {
  const available = '(i.quantity_on_hand - i.quantity_reserved)';
  if (status === 'outOfStock') return `${available} <= 0`;
  if (status === 'lowStock') {
    return `${available} > 0 and i.reorder_point is not null and ${available} <= i.reorder_point`;
  }
  if (status === 'inStock') {
    return `${available} > 0 and (i.reorder_point is null or ${available} > i.reorder_point)`;
  }
  return '';
}

function publishedListingCondition(alias) {
  return `${alias}.status='active'
    and lower(coalesce(${alias}.metadata->>'isPublished', 'false'))='true'
    and (${alias}.channel_code <> 'falabella'
      or (
        lower(coalesce(${alias}.metadata->>'status', ''))='active'
        and lower(coalesce(${alias}.metadata->>'marketplaceStatus', ''))='active'
        and lower(coalesce(${alias}.metadata->>'qcStatus', ''))='approved'
      ))`;
}

function publicationExistsSql(companyIdsParameter = '') {
  return `exists (
    select 1
    from product_listings publication_listing
    where publication_listing.product_id=p.id
      ${companyIdsParameter ? `and publication_listing.company_id=any(${companyIdsParameter}::int[])` : ''}
      and ${publishedListingCondition('publication_listing')}
  )`;
}

function companyIds(filters = {}) {
  const requested = filters.companyIds ?? filters.companyId;
  if (requested === undefined || requested === null || String(requested).trim() === '') return [];
  const rawIds = Array.isArray(requested) ? requested : String(requested).split(',');
  const ids = [...new Set(rawIds.map((value) => positiveInt(value, 'companyIds')))];
  if (ids.length > 100) throw httpError('companyIds admite hasta 100 sellers.');
  return ids;
}

function catalogOrder(filters = {}) {
  const sortBy = String(filters.sortBy || 'updatedAt').trim();
  if (!Object.hasOwn(CATALOG_SORTS, sortBy)) throw httpError('sortBy inválido.');
  const requestedDirection = String(filters.sortDir || (sortBy === 'name' ? 'asc' : 'desc')).trim().toLowerCase();
  if (!['asc', 'desc'].includes(requestedDirection)) throw httpError('sortDir inválido.');
  const selected = CATALOG_SORTS[sortBy];
  return {
    requiresListingStats: selected.requiresListingStats === true,
    catalog: `${selected.catalog} ${requestedDirection} nulls last, p.id desc`,
    page: `${selected.page} ${requestedDirection} nulls last, page.id desc`,
  };
}

function listingStatsSql(productId) {
  return `select
    count(l.id) filter (where l.status='active') as listings_count,
    count(distinct l.company_id) filter (where l.status='active') as sellers_count,
    coalesce(array_agg(distinct l.channel_code) filter (where l.status='active'), '{}') as channels,
    min((coalesce(l.metadata->>'effectivePrice', l.metadata->>'price'))::numeric)
      filter (where l.status='active' and coalesce(l.metadata->>'effectivePrice', l.metadata->>'price') ~ '^[0-9]+([.][0-9]+)?$') as seller_price_min,
    max((coalesce(l.metadata->>'effectivePrice', l.metadata->>'price'))::numeric)
      filter (where l.status='active' and coalesce(l.metadata->>'effectivePrice', l.metadata->>'price') ~ '^[0-9]+([.][0-9]+)?$') as seller_price_max,
    coalesce(sum(l.marketplace_quantity) filter (where l.status='active'), 0) as seller_stock_total
  from product_listings l
  where l.product_id=${productId}`;
}

function specialFilter(filters = {}) {
  const requested = String(filters.special || '').trim();
  if (requested) {
    if (!SPECIAL_FILTERS.includes(requested)) throw httpError('special inválido.');
    return requested;
  }
  if (filters.lowStock === 'true' || filters.lowStock === true) return 'lowStock';
  return 'none';
}

function appendCatalogSearch(filters = {}, values, where) {
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
  if (filters.channelCode && filters.channelCode !== 'all') {
    values.push(String(filters.channelCode).trim().toLowerCase());
    where.push(`exists (
      select 1 from product_listings channel_listing
      where channel_listing.product_id=p.id and channel_listing.channel_code=$${values.length}
        and channel_listing.status='active'
    )`);
  }
  const selectedCompanyIds = companyIds(filters);
  let companyIdsParameter = '';
  if (selectedCompanyIds.length) {
    values.push(selectedCompanyIds);
    companyIdsParameter = `$${values.length}`;
    where.push(`exists (
      select 1 from product_listings company_listing
      where company_listing.product_id=p.id and company_listing.company_id=any(${companyIdsParameter}::int[])
        and company_listing.status='active'
    )`);
  }
  return { selectedCompanyIds, companyIdsParameter };
}

function catalogListConstraints(filters = {}) {
  const values = [];
  const where = [];
  const { companyIdsParameter } = appendCatalogSearch(filters, values, where);
  if (filters.status && filters.status !== 'all') {
    values.push(productStatus(filters.status));
    where.push(`p.status=$${values.length}`);
  } else if (!filters.status && filters.includeArchived !== 'true' && filters.includeArchived !== true) {
    where.push(`p.status <> 'archived'`);
  }
  const sellerCoverage = String(filters.sellerCoverage || 'all').trim().toLowerCase();
  if (!SELLER_COVERAGES.includes(sellerCoverage)) throw httpError('sellerCoverage inválido.');
  if (sellerCoverage !== 'all') {
    const comparison = sellerCoverage === 'none' ? '= 0' : sellerCoverage === 'single' ? '= 1' : '> 1';
    where.push(`${sellerCountSql()} ${comparison}`);
  }
  const inventoryStatus = String(filters.inventoryStatus || 'all').trim();
  if (!INVENTORY_STATUSES.includes(inventoryStatus)) throw httpError('inventoryStatus inválido.');
  if (inventoryStatus !== 'all') where.push(inventoryStatusSql(inventoryStatus));

  const publicationStatus = String(filters.publicationStatus || 'all').trim().toLowerCase();
  if (!PUBLICATION_STATUSES.includes(publicationStatus)) throw httpError('publicationStatus inválido.');
  if (publicationStatus === 'published') {
    where.push(publicationExistsSql(companyIdsParameter));
  } else if (publicationStatus === 'unpublished') {
    where.push(`not ${publicationExistsSql(companyIdsParameter)}`);
  }

  const special = specialFilter(filters);
  if (special === 'outOfStock') {
    where.push(`${sellerCountSql()} > 0`);
    where.push(`${sellerStockSql()} = 0`);
  } else if (special === 'unpublished') {
    where.push(`${sellerCountSql()} = 0`);
  } else if (special === 'lowStock') {
    where.push(lowStockSql());
  }
  return { values, where, sellerCoverage, inventoryStatus, publicationStatus, special };
}

function catalogSummaryScope(filters = {}) {
  if (filters.status && filters.status !== 'all') {
    return `p.status='${productStatus(filters.status)}'`;
  }
  if (filters.status === 'all') return 'true';
  if (filters.includeArchived === 'true' || filters.includeArchived === true) return 'true';
  return `p.status <> 'archived'`;
}

function catalogSummaryTotalScope(filters = {}) {
  if (filters.status === 'all') return 'true';
  if (filters.includeArchived === 'true' || filters.includeArchived === true) return 'true';
  return `p.status <> 'archived'`;
}

function mapCatalogSummary(row = {}) {
  const unitsAvailable = Number(row.units_available || 0);
  const unitsSold30 = Number(row.units_sold_30 || 0);
  return {
    total: Number(row.total || 0),
    active: Number(row.active || 0),
    inactive: Number(row.inactive || 0),
    archived: Number(row.archived || 0),
    singleSeller: Number(row.single_seller || 0),
    multipleSellers: Number(row.multiple_sellers || 0),
    outOfStock: Number(row.out_of_stock || 0),
    unpublished: Number(row.unpublished || 0),
    lowStock: Number(row.low_stock || 0),
    withStock: Number(row.with_stock || 0),
    withoutStock: Number(row.without_stock || 0),
    withoutSales: Number(row.without_sales || 0),
    unitsAvailable,
    unitsReserved: Number(row.units_reserved || 0),
    unitsToReorder: Number(row.units_to_reorder || 0),
    inventoryValue: Number(row.inventory_value || 0),
    unitsSold30,
    revenue30: Number(row.revenue_30 || 0),
    daysOfSupply: unitsSold30 > 0 ? unitsAvailable / (unitsSold30 / 30) : null,
    sellThrough30: (unitsSold30 + unitsAvailable) > 0
      ? (unitsSold30 / (unitsSold30 + unitsAvailable)) * 100
      : null,
    scopedTotal: Number(row.scoped_total || 0),
  };
}

function catalogSales30Cte() {
  return `sales30 as (
    select mapped.product_id,
      sum(mapped.quantity)::numeric as sold,
      sum(mapped.line_total)::numeric as revenue
    from (
      select
        coalesce(oi.product_id, linked.product_id, listing.product_id) as product_id,
        oi.quantity,
        coalesce(oi.total, oi.unit_price * oi.quantity, 0) as line_total
      from order_items oi
      join orders o on o.id=oi.order_id
      left join falabella_orders fo
        on fo.company_id=o.company_id and fo.order_id=o.external_order_id
      left join product_listings linked on linked.id=oi.listing_id
      left join lateral (
        select l.product_id
        from product_listings l
        where l.company_id=o.company_id
          and l.status='active'
          and (
            (nullif(trim(oi.sku), '') is not null and l.seller_sku=oi.sku)
            or (nullif(trim(oi.provider_sku), '') is not null and l.shop_sku=oi.provider_sku)
            or (nullif(trim(oi.sku), '') is not null and l.shop_sku=oi.sku)
          )
        order by
          case
            when nullif(trim(oi.sku), '') is not null and l.seller_sku=oi.sku then 0
            when nullif(trim(oi.provider_sku), '') is not null and l.shop_sku=oi.provider_sku then 1
            else 2
          end,
          l.id
        limit 1
      ) listing on true
      where o.order_status in ('confirmed','completed')
        and coalesce(o.fulfillment_status, '') <> 'returned'
        and lower(coalesce(fo.status, '')) !~ '(return|cancel|failed)'
        and lower(coalesce(oi.provider_status, '')) !~ '(return|cancel|failed)'
        and o.ordered_at >= now() - interval '30 days'
    ) mapped
    where mapped.product_id is not null
    group by mapped.product_id
  )`;
}

export async function getCatalogSummary(filters = {}, db) {
  const target = db || (await loadCore()).pool;
  return summarizeProducts(filters, target);
}

async function summarizeProducts(filters = {}, db) {
  const { values, where } = catalogListConstraints(filters);
  const clause = where.length ? `where ${where.join(' and ')}` : '';
  const scope = catalogSummaryScope(filters);
  const totalScope = catalogSummaryTotalScope(filters);
  const result = await db.query(
    `with ${catalogSales30Cte()}
     select
       count(*) filter (where ${scope}) as scoped_total,
       count(*) filter (where ${totalScope}) as total,
       count(*) filter (where p.status = 'active') as active,
       count(*) filter (where p.status = 'inactive') as inactive,
       count(*) filter (where p.status = 'archived') as archived,
       count(*) filter (where ${scope} and coverage.sellers_count = 1) as single_seller,
       count(*) filter (where ${scope} and coverage.sellers_count > 1) as multiple_sellers,
       count(*) filter (where ${scope} and coverage.sellers_count > 0 and coverage.seller_stock_total = 0) as out_of_stock,
       count(*) filter (where ${scope} and coverage.sellers_count = 0) as unpublished,
       count(*) filter (where ${scope} and ${inventoryStatusSql('lowStock')}) as low_stock,
       count(*) filter (where ${scope} and ${inventoryStatusSql('inStock')}) as with_stock,
       count(*) filter (where ${scope} and ${inventoryStatusSql('outOfStock')}) as without_stock,
       count(*) filter (where ${scope} and coalesce(sales30.sold, 0) = 0) as without_sales,
       coalesce(sum(i.quantity_on_hand - i.quantity_reserved) filter (where ${scope}), 0) as units_available,
       coalesce(sum(i.quantity_reserved) filter (where ${scope}), 0) as units_reserved,
       coalesce(sum(greatest(0, coalesce(i.reorder_point, sales30.sold, 0) - (i.quantity_on_hand - i.quantity_reserved))) filter (where ${scope}), 0) as units_to_reorder,
       coalesce(sum((i.quantity_on_hand - i.quantity_reserved) * coalesce(coverage.listing_price, p.reference_price, 0)) filter (where ${scope}), 0) as inventory_value,
       coalesce(sum(sales30.sold) filter (where ${scope}), 0) as units_sold_30,
       coalesce(sum(sales30.revenue) filter (where ${scope}), 0) as revenue_30
     from products p
     join product_inventory i on i.product_id=p.id
     left join sales30 on sales30.product_id=p.id
     cross join lateral (
       select
         count(distinct l.company_id) filter (where l.status='active') as sellers_count,
         coalesce(sum(l.marketplace_quantity) filter (where l.status='active'), 0) as seller_stock_total,
         min((coalesce(l.metadata->>'effectivePrice', l.metadata->>'price'))::numeric)
           filter (where l.status='active' and coalesce(l.metadata->>'effectivePrice', l.metadata->>'price') ~ '^[0-9]+([.][0-9]+)?$') as listing_price
       from product_listings l
       where l.product_id=p.id
     ) coverage
     ${clause}`,
    values,
  );
  return mapCatalogSummary(result.rows[0]);
}

const TODAY_SALES_SORTS = {
  product: 'min(name)',
  units: 'sum(units_sold)',
  stock: 'min(quantity_on_hand)',
  sellers: 'count(distinct company_id)',
};

function todaySalesOrderSql(filters = {}) {
  const sortBy = TODAY_SALES_SORTS[String(filters.sortBy || 'units')] || TODAY_SALES_SORTS.units;
  const sortDir = String(filters.sortDir || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  return `${sortBy} ${sortDir} nulls last, min(name), min(sku)`;
}

export async function listProducts(filters = {}, db) {
  const target = db || (await loadCore()).pool;
  const { limit, offset } = limitOffset(filters);
  const { values, where } = catalogListConstraints(filters);
  const clause = where.length ? `where ${where.join(' and ')}` : '';
  const pageValues = [...values, limit, offset];
  const order = catalogOrder(filters);
  const catalogSql = order.requiresListingStats
    ? `select p.*, i.quantity_on_hand, i.quantity_reserved, i.reorder_point,
         i.quantity_on_hand - i.quantity_reserved as available,
         count(*) over() as total_count,
         listing_stats.listings_count,
         listing_stats.sellers_count,
         listing_stats.channels,
         listing_stats.seller_price_min,
         listing_stats.seller_price_max,
         listing_stats.seller_stock_total
       from products p
       join product_inventory i on i.product_id=p.id
       cross join lateral (${listingStatsSql('p.id')}) listing_stats
       ${clause}
       order by ${order.catalog}
       limit $${pageValues.length - 1} offset $${pageValues.length}`
    : `select page.*,
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
         order by ${order.catalog}
         limit $${pageValues.length - 1} offset $${pageValues.length}
       ) page
       cross join lateral (${listingStatsSql('page.id')}) listing_stats
       order by ${order.page}`;
  const [result, summary] = await Promise.all([
    target.query(catalogSql, pageValues),
    summarizeProducts(filters, target),
  ]);
  return {
    products: result.rows.map(mapProduct),
    totalCount: result.rows[0] ? Number(result.rows[0].total_count) : 0,
    limit,
    offset,
    summary,
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

const TODAY_SALES_ELIGIBLE = `(o.id is null or o.order_status in ('new','confirmed','completed'))
    and coalesce(o.fulfillment_status, '') not in ('returned','cancelled','failed')
    and lower(coalesce(fo.status, '')) !~ '(return|cancel|failed)'
    and lower(coalesce(oi.provider_status, '')) !~ '(return|cancel|failed)'`;

export function limaDaySql(expr, param = 1) {
  return `(${expr} is not null and ${expr} >= timezone('America/Lima', $${param}::date) and ${expr} < timezone('America/Lima', ($${param}::date + 1)))`;
}

export const PROMISED_SHIPPING_SQL = `coalesce(
  o.promised_shipping_at,
  case
    when fo.raw_data->>'PromisedShippingTime' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
      and fo.raw_data->>'PromisedShippingTime' ~* '(t|z|[+-][0-9]{2})'
      then (fo.raw_data->>'PromisedShippingTime')::timestamptz
    when fo.raw_data->>'PromisedShippingTime' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
      then ((fo.raw_data->>'PromisedShippingTime') || '+00')::timestamptz
    else null
  end
)`;

export async function listTodayProductSales(filters = {}, db) {
  const target = db || (await loadCore()).pool;
  const { limit, offset } = limitOffset({ ...filters, limit: filters.limit || 20 });
  const date = limaDate(filters.date);
  const values = [date];
  const where = [
    limaDaySql(PROMISED_SHIPPING_SQL),
    TODAY_SALES_ELIGIBLE,
  ];
  if (filters.companyId) {
    values.push(positiveInt(filters.companyId, 'companyId'));
    where.push(`o.company_id=$${values.length}`);
  }
  const search = String(filters.search || '').trim();
  if (search) {
    values.push(`%${search}%`);
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
  const eligibleCte = `eligible as (
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
          nullif(listing.metadata->'images'->>0, ''),
          nullif(listing.metadata->'images'->0->>'Url', ''),
          nullif(listing.metadata->'images'->0->>'url', ''),
          nullif(listing.metadata->>'imageUrl', ''),
          nullif(listing.metadata->>'fingerprintImageUrl', ''),
          nullif(linked.metadata->'images'->>0, ''),
          nullif(linked.metadata->'images'->0->>'Url', ''),
          nullif(linked.metadata->>'imageUrl', ''),
          nullif(oi.raw_data->>'Image', ''),
          nullif(oi.raw_data->>'ImageUrl', ''),
          nullif(oi.raw_data->>'ImageURL', ''),
          nullif(oi.raw_data->>'ProductImage', ''),
          nullif(oi.raw_data->>'MainImage', ''),
          nullif(oi.raw_data#>>'{Images,Image,0}', ''),
          nullif(oi.raw_data#>>'{Images,0}', ''),
          (
            select coalesce(
              nullif(photo.metadata->'images'->>0, ''),
              nullif(photo.metadata->'images'->0->>'Url', ''),
              nullif(photo.metadata->>'imageUrl', '')
            )
            from product_listings photo
            where photo.product_id=coalesce(oi.product_id, linked.product_id, listing.product_id)
              and photo.status='active'
              and (
                nullif(photo.metadata->'images'->>0, '') is not null
                or nullif(photo.metadata->'images'->0->>'Url', '') is not null
                or nullif(photo.metadata->>'imageUrl', '') is not null
              )
            order by photo.id
            limit 1
          ),
          case
            when coalesce(
              nullif(trim(listing.shop_sku), ''),
              nullif(trim(linked.shop_sku), ''),
              nullif(trim(oi.provider_sku), ''),
              nullif(trim(oi.raw_data->>'ShopSku'), ''),
              nullif(trim(oi.raw_data->>'ShopSKU'), '')
            ) ~ '^[A-Za-z0-9_-]+$'
            then 'https://media.falabella.com/falabellaPE/' || coalesce(
              nullif(trim(listing.shop_sku), ''),
              nullif(trim(linked.shop_sku), ''),
              nullif(trim(oi.provider_sku), ''),
              nullif(trim(oi.raw_data->>'ShopSku'), ''),
              nullif(trim(oi.raw_data->>'ShopSKU'), '')
            ) || '_01'
            else null
          end
        ) as image_url,
        coalesce(
          nullif(trim(listing.shop_sku), ''),
          nullif(trim(linked.shop_sku), ''),
          nullif(trim(oi.provider_sku), ''),
          nullif(trim(oi.raw_data->>'ShopSku'), ''),
          nullif(trim(oi.raw_data->>'ShopSKU'), '')
        ) as shop_sku,
        p.brand,
        i.quantity_on_hand,
        coalesce(i.quantity_on_hand, 0) - coalesce(i.quantity_reserved, 0) as available,
        o.id as order_id,
        o.company_id,
        coalesce(nullif(c.nombre_comercial, ''), nullif(c.nombre, ''), c.razon_social) as company_name,
        coalesce(nullif(linked.title, ''), nullif(listing.title, ''), nullif(oi.description, '')) as seller_title,
        coalesce(nullif(linked.seller_sku, ''), nullif(listing.seller_sku, ''), nullif(oi.sku, ''), nullif(oi.provider_sku, '')) as seller_sku,
        oi.quantity,
        coalesce(oi.total, oi.unit_price * oi.quantity, 0) as line_total
      from order_items oi
      join orders o on o.id=oi.order_id
      left join falabella_orders fo
        on fo.company_id=o.company_id and fo.order_id=o.external_order_id
      left join companies c on c.id=o.company_id
      left join product_listings linked on linked.id=oi.listing_id
      left join lateral (
        select l.product_id, l.title, l.seller_sku, l.shop_sku, l.metadata
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
      left join product_inventory i on i.product_id=p.id
      where ${where.join(' and ')}
    )`;
  const totalsValues = [...values];
  const pendingValues = [date];
  if (filters.companyId) pendingValues.push(positiveInt(filters.companyId, 'companyId'));
  values.push(limit, offset);
  const [pageResult, totalsResult, pendingResult] = await Promise.all([
    target.query(
      `with ${eligibleCte},
       seller_rows as (
         select product_key, product_id, sku, name, image_url, shop_sku, brand, quantity_on_hand, available,
           company_id, company_name, seller_title, seller_sku,
           sum(quantity) as units_sold,
           count(distinct order_id) as orders_count,
           sum(line_total) as revenue
         from eligible
         group by 1,2,3,4,5,6,7,8,9,10,11,12,13
       )
       select
         product_key,
         min(product_id) as product_id,
         min(sku) as sku,
         min(name) as name,
         min(image_url) as image_url,
         min(shop_sku) as shop_sku,
         min(brand) as brand,
         min(quantity_on_hand) as quantity_on_hand,
         min(available) as available,
         sum(units_sold) as units_sold,
         sum(orders_count) as orders_count,
         count(distinct company_id)::int as sellers_count,
         sum(revenue) as revenue,
         jsonb_agg(jsonb_build_object(
           'companyId', company_id,
           'companyName', company_name,
           'title', seller_title,
           'sellerSku', seller_sku,
           'unitsSold', units_sold,
           'ordersCount', orders_count
         ) order by units_sold desc, company_name, seller_title) as sellers
       from seller_rows
       group by product_key
       order by ${todaySalesOrderSql(filters)}
       limit $${values.length - 1} offset $${values.length}`,
      values,
    ),
    target.query(
      `with ${eligibleCte},
       totals as (
         select
           count(distinct product_key)::int as products_count,
           coalesce(sum(quantity), 0) as units_sold,
           count(distinct order_id)::int as orders_count,
           count(distinct company_id)::int as sellers_count
         from eligible
       )
       select
         totals.*,
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'companyId', seller.company_id,
             'companyName', seller.company_name,
             'unitsSold', seller.units_sold,
             'ordersCount', seller.orders_count,
             'productsCount', seller.products_count
           ) order by seller.units_sold desc, seller.company_name)
           from (
             select
               company_id,
               min(company_name) as company_name,
               coalesce(sum(quantity), 0) as units_sold,
               count(distinct order_id)::int as orders_count,
               count(distinct product_key)::int as products_count
             from eligible
             group by company_id
           ) seller
         ), '[]'::jsonb) as sellers
       from totals`,
      totalsValues,
    ),
    target.query(
      `select count(*)::int as pending_orders
       from falabella_orders fo
       left join orders o
         on o.company_id=fo.company_id and o.external_order_id=fo.order_id
       where lower(coalesce(fo.status, '')) !~ '(return|cancel|failed)'
         ${filters.companyId ? 'and fo.company_id=$2' : ''}
         and ${limaDaySql(PROMISED_SHIPPING_SQL)}
         and not exists (
           select 1 from orders matched
           join order_items item on item.order_id=matched.id
           where matched.company_id=fo.company_id and matched.external_order_id=fo.order_id
         )`,
      pendingValues,
    ),
  ]);
  const totals = totalsResult.rows[0] || {};
  const pendingOrders = Number(pendingResult.rows[0]?.pending_orders || 0);
  return {
    date,
    timezone: 'America/Lima',
    products: pageResult.rows.map((row) => ({
      productKey: row.product_key,
      productId: row.product_id == null ? null : Number(row.product_id),
      sku: row.sku,
      name: row.name,
      imageUrl: row.image_url || null,
      shopSku: row.shop_sku || null,
      brand: row.brand || null,
      mapped: row.product_id != null,
      quantityOnHand: row.quantity_on_hand == null ? null : Number(row.quantity_on_hand),
      available: row.available == null ? null : Number(row.available),
      unitsSold: Number(row.units_sold || 0),
      ordersCount: Number(row.orders_count || 0),
      sellersCount: Number(row.sellers_count || 0),
      revenue: Number(row.revenue || 0),
      sellers: (Array.isArray(row.sellers) ? row.sellers : []).map((seller) => ({
        companyId: seller.companyId == null ? null : Number(seller.companyId),
        companyName: seller.companyName || null,
        title: seller.title || null,
        sellerSku: seller.sellerSku || null,
        unitsSold: Number(seller.unitsSold || 0),
        ordersCount: Number(seller.ordersCount || 0),
      })),
    })),
    totalCount: Number(totals.products_count || 0),
    totals: {
      productsCount: Number(totals.products_count || 0),
      unitsSold: Number(totals.units_sold || 0),
      ordersCount: Number(totals.orders_count || 0),
      sellersCount: Number(totals.sellers_count || 0),
      pendingDetailOrders: pendingOrders,
      sellers: (Array.isArray(totals.sellers) ? totals.sellers : []).map((seller) => ({
        companyId: seller.companyId == null ? null : Number(seller.companyId),
        companyName: seller.companyName || null,
        unitsSold: Number(seller.unitsSold || 0),
        ordersCount: Number(seller.ordersCount || 0),
        productsCount: Number(seller.productsCount || 0),
      })),
    },
    limit,
    offset,
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
