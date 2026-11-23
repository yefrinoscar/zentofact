// Catálogo de solo lectura para el perfil Vendedor: productos activos, stock
// disponible, precio y la Comisión que ganaría por unidad. Solo expone campos
// seguros para un vendedor (sin precio por mayor, dueño de la ganancia,
// costos, publicaciones ni datos de sellers o marketplaces).
import { inventoryAvailableSql, listingStatsSql } from './catalog/product-service.js';
import { httpError, loadCore } from './catalog/utils.js';

export const SALESPERSON_CATALOG_STOCK_FILTERS = ['all', 'inStock', 'outOfStock'];
export const SALESPERSON_CATALOG_DEFAULT_LIMIT = 25;
export const SALESPERSON_CATALOG_MAX_LIMIT = 100;
const SEARCH_MAX_LENGTH = 120;

// Columnas de orden permitidas. Nunca se interpola la entrada del usuario:
// solo se elige una de estas expresiones fijas.
const SORT_SQL = {
  name: 'lower(base.name)',
  price: 'base.price',
  commission: 'commission_estimate',
  stock: 'base.available',
};
export const SALESPERSON_CATALOG_SORT_FIELDS = Object.keys(SORT_SQL);

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function nonNegativeInt(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw httpError(`${field} inválido.`, 400);
  return parsed;
}

function present(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

export function parseSalespersonCatalogFilters(input = {}) {
  const search = String(input.search ?? '').trim();
  if (search.length > SEARCH_MAX_LENGTH) throw httpError('search es demasiado largo.', 400);

  const stock = present(input.stock) ? String(input.stock).trim() : 'all';
  if (!SALESPERSON_CATALOG_STOCK_FILTERS.includes(stock)) throw httpError('stock inválido.', 400);

  const sortBy = present(input.sortBy) ? String(input.sortBy).trim() : 'name';
  if (!Object.hasOwn(SORT_SQL, sortBy)) throw httpError('sortBy inválido.', 400);

  const sortDir = present(input.sortDir) ? String(input.sortDir).trim().toLowerCase() : 'asc';
  if (!['asc', 'desc'].includes(sortDir)) throw httpError('sortDir inválido.', 400);

  let limit = SALESPERSON_CATALOG_DEFAULT_LIMIT;
  if (present(input.limit)) {
    limit = nonNegativeInt(input.limit, 'limit');
    if (limit < 1) throw httpError('limit inválido.', 400);
    limit = Math.min(limit, SALESPERSON_CATALOG_MAX_LIMIT);
  }
  const offset = present(input.offset) ? nonNegativeInt(input.offset, 'offset') : 0;

  return { search, stock, sortBy, sortDir, limit, offset };
}

export function normalizeCommissionPercent(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Mismo criterio que `productPrice` en la web (registrar-venta.ts). */
export function salespersonProductPrice(referencePrice, sellerPriceMin) {
  const reference = Number(referencePrice);
  if (referencePrice != null && Number.isFinite(reference) && reference > 0) return reference;
  const seller = Number(sellerPriceMin);
  return sellerPriceMin != null && Number.isFinite(seller) && seller > 0 ? seller : 0;
}

/**
 * Comisión por unidad: la fija del Producto si existe; si no, el % del
 * vendedor sobre el precio; si tampoco, no hay comisión.
 */
export function unitCommission(productCommissionAmount, price, commissionPercent) {
  if (productCommissionAmount !== null && productCommissionAmount !== undefined && productCommissionAmount !== '') {
    const amount = Number(productCommissionAmount);
    if (Number.isFinite(amount)) return { commissionAmount: amount, commissionRule: 'catalog' };
  }
  const percent = normalizeCommissionPercent(commissionPercent);
  if (percent > 0) {
    return { commissionAmount: round2((Number(price) || 0) * percent / 100), commissionRule: 'percent' };
  }
  return { commissionAmount: null, commissionRule: 'none' };
}

export function mapSalespersonCatalogRow(row, commissionPercent) {
  const price = salespersonProductPrice(row.reference_price, row.seller_price_min);
  return {
    id: Number(row.id),
    sku: row.main_sku,
    name: row.name,
    brand: row.brand || null,
    imageUrl: row.image_url || null,
    price,
    available: Number(row.available) || 0,
    ...unitCommission(row.commission_amount, price, commissionPercent),
  };
}

export function salespersonCatalogQuery(filters, commissionPercent) {
  const values = [commissionPercent];
  const where = [`p.status='active'`];
  if (filters.search) {
    values.push(`%${filters.search}%`);
    where.push(`(p.main_sku ilike $${values.length} or p.name ilike $${values.length})`);
  }
  const available = inventoryAvailableSql();
  if (filters.stock === 'inStock') where.push(`${available} > 0`);
  if (filters.stock === 'outOfStock') where.push(`${available} <= 0`);
  values.push(filters.limit, filters.offset);
  const sort = SORT_SQL[filters.sortBy];
  const dir = filters.sortDir === 'desc' ? 'desc' : 'asc';
  const sql = `with base as (
      select p.id, p.main_sku, p.name, p.brand, p.image_url, p.commission_amount,
        p.reference_price, listing_stats.seller_price_min,
        ${available} as available,
        case
          when coalesce(p.reference_price, 0) > 0 then p.reference_price
          when coalesce(listing_stats.seller_price_min, 0) > 0 then listing_stats.seller_price_min
          else 0
        end::numeric as price
      from products p
      join product_inventory i on i.product_id=p.id
      cross join lateral (${listingStatsSql('p.id')}) listing_stats
      where ${where.join(' and ')}
    )
    select base.id, base.main_sku, base.name, base.brand, base.image_url, base.commission_amount,
      base.reference_price, base.seller_price_min, base.available,
      case
        when base.commission_amount is not null then base.commission_amount
        when $1::numeric > 0 then round(base.price * $1::numeric / 100, 2)
        else null
      end as commission_estimate,
      count(*) over() as total_count
    from base
    order by ${sort} ${dir} nulls last, base.id ${dir}
    limit $${values.length - 1} offset $${values.length}`;
  return { sql, values };
}

export async function listSalespersonCatalog(input = {}, { commissionPercent = 0 } = {}, db) {
  const filters = parseSalespersonCatalogFilters(input);
  const percent = normalizeCommissionPercent(commissionPercent);
  const target = db || (await loadCore()).pool;
  const { sql, values } = salespersonCatalogQuery(filters, percent);
  const result = await target.query(sql, values);
  return {
    items: result.rows.map((row) => mapSalespersonCatalogRow(row, percent)),
    total: result.rows[0] ? Number(result.rows[0].total_count) : 0,
    limit: filters.limit,
    offset: filters.offset,
    commissionPercent: percent,
  };
}
