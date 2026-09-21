import { loadCore } from './utils.js';

// Tallas que no diferencian variante: no cuentan como desajuste.
const UNIVERSAL_SIZES = new Set([
  'U', 'UNICA', 'UNICO', 'UNISEX', 'UNISEXO',
  'ESTANDAR', 'STANDARD', 'ONE SIZE', 'ONESIZE', 'TALLA UNICA', 'TALLA ESTANDAR',
]);

// Token de talla independiente dentro de un título. El alternation va de la
// talla más larga a la más corta para no partir "XXL" en "XL".
const SIZE_TOKEN_RE = /\b(XXXL|XXL|XXS|XL|XS|S|M|L|[2-9]XL)\b/;

// Una talla solo es comparable si es exactamente uno de estos valores. Otros
// valores (por ejemplo "1", ids de marketplace) no son tallas utilizables.
const KNOWN_SIZE_RE = /^(XXXL|XXL|XXS|XL|XS|S|M|L|[2-9]XL)$/;

function fold(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Normaliza una talla a su forma comparable. Devuelve `''` cuando la talla es
 * universal (aplica a cualquier variante) y `null` cuando no hay una talla
 * reconocible.
 */
export function normalizeSize(value) {
  const folded = fold(value);
  if (!folded) return null;
  if (UNIVERSAL_SIZES.has(folded)) return '';
  return KNOWN_SIZE_RE.test(folded) ? folded : null;
}

/** Extrae una talla escrita en un título, si existe. */
export function sizeFromText(value) {
  const match = fold(value).match(SIZE_TOKEN_RE);
  return match ? match[1] : null;
}

function rowListingSize(row) {
  const fromMetadata = normalizeSize(row.listing_size);
  if (fromMetadata !== null) return fromMetadata;
  return normalizeSize(sizeFromText(row.title));
}

function mapMismatch(row, listingSize, masterSize) {
  return {
    productId: Number(row.product_id),
    mainSku: row.main_sku,
    productName: row.product_name,
    listingId: Number(row.listing_id),
    channelCode: row.channel_code,
    companyId: Number(row.company_id),
    companyName: row.company_name || null,
    sellerSku: row.seller_sku,
    shopSku: row.shop_sku || null,
    title: row.title,
    listingSize,
    masterSize,
  };
}

/**
 * Filtra publicaciones activas cuya talla (metadata o título) no coincide con
 * la talla del producto maestro. Una talla universal en cualquiera de los dos
 * lados nunca es un desajuste.
 */
export function findListingSizeMismatches(rows = []) {
  const mismatches = [];
  for (const row of rows) {
    const masterSize = normalizeSize(row.master_size);
    if (!masterSize) continue;
    const listingSize = rowListingSize(row);
    if (!listingSize || listingSize === masterSize) continue;
    mismatches.push(mapMismatch(row, listingSize, masterSize));
  }
  return mismatches;
}

/** Lista de publicaciones activas con talla distinta a la de su maestro. */
export async function listListingSizeMismatches(db) {
  const target = db || (await loadCore()).pool;
  const result = await target.query(
    `select l.id as listing_id, l.product_id, p.main_sku, p.name as product_name,
            l.channel_code, l.company_id, l.seller_sku, l.shop_sku, l.title,
            l.metadata->>'size' as listing_size,
            p.attributes->>'size' as master_size,
            coalesce(nullif(c.nombre_comercial, ''), nullif(c.nombre, ''), c.razon_social) as company_name
       from product_listings l
       join products p on p.id = l.product_id
       left join companies c on c.id = l.company_id
      where l.status = 'active'
        and coalesce(p.status, 'active') <> 'archived'
        and nullif(trim(p.attributes->>'size'), '') is not null
      order by p.main_sku asc, l.company_id asc, l.channel_code asc, l.id asc
      limit 5000`,
  );
  const items = findListingSizeMismatches(result.rows);
  return { items, total: items.length };
}
