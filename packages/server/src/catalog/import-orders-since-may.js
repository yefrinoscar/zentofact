import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { excelMasterForSku, planListingExcelRemap } from './historical-sku-map.js';
import { MAPPING_CHANNELS, SALES_HISTORY_SINCE } from './historical-sales-mapping.js';
import { ensureAnchorProduct, listingMasterSku } from './sales-mapping-bundle.js';

export const ORDER_DUMP_TABLES = Object.freeze([
  'companies',
  'order_channel_accounts',
  'orders',
  'order_items',
  'order_events',
  'product_listings',
  'falabella_orders',
  'falabella_order_lifecycle',
]);

export const FORBIDDEN_DUMP_TABLES = Object.freeze([
  'products',
  'product_inventory',
  'inventory_movements',
]);

export const EXPORT_ORDERS_DUMP_COMMAND = [
  'pg_dump "$DATABASE_URL_POSTGRES" --data-only --inserts --no-owner --no-privileges',
  '-t companies -t order_channel_accounts -t orders -t order_items -t order_events',
  '-t product_listings -t falabella_orders -t falabella_order_lifecycle',
  '-f orders-since-may.sql',
].join(' \\\n  ');

export const ORDER_DUMP_TRUNCATE_SQL = `
TRUNCATE TABLE
  order_items,
  order_events,
  order_snapshots,
  order_commands,
  order_documents,
  orders,
  falabella_orders,
  falabella_order_lifecycle,
  product_listings
RESTART IDENTITY CASCADE
`.trim();

export const COMPANIES_DUMP_TRUNCATE_SQL = `
TRUNCATE TABLE order_channel_accounts, companies RESTART IDENTITY CASCADE
`.trim();

function tableMentioned(sql, table) {
  return new RegExp(
    String.raw`(?:COPY\s+(?:public\.)?${table}\b|INSERT\s+INTO\s+(?:public\.)?${table}\b)`,
    'i',
  ).test(sql);
}

export function inspectOrdersDump(sqlText) {
  const text = String(sqlText || '');
  const tables = ORDER_DUMP_TABLES.filter((table) => tableMentioned(text, table));
  const forbidden = FORBIDDEN_DUMP_TABLES.filter((table) => tableMentioned(text, table));
  return {
    tables,
    forbidden,
    hasOrders: tables.includes('orders') && tables.includes('order_items'),
    hasCompanies: tables.includes('companies'),
    hasListings: tables.includes('product_listings'),
    hasEvents: tables.includes('order_events'),
  };
}

export function assertOrdersDumpAllowed(inspection) {
  if (inspection.forbidden.length) {
    throw new Error(
      `El dump no puede incluir catálogo ni inventario: ${inspection.forbidden.join(', ')}.`,
    );
  }
  if (!inspection.hasOrders) {
    throw new Error('El dump debe incluir orders y order_items.');
  }
}

export function restoreOrdersDump({
  sqlPath,
  databaseUrl,
  inspectText,
  execFile = execFileSync,
} = {}) {
  const sql = inspectText ?? readFileSync(sqlPath, 'utf8');
  const inspection = inspectOrdersDump(sql);
  assertOrdersDumpAllowed(inspection);
  if (!databaseUrl) {
    throw new Error('DATABASE_URL_POSTGRES is required to import a dump');
  }
  const env = { ...process.env, PGOPTIONS: '-c session_replication_role=replica' };
  const psql = (args) => execFile('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', ...args], {
    env,
    stdio: 'inherit',
  });
  if (inspection.hasCompanies) {
    psql(['-c', COMPANIES_DUMP_TRUNCATE_SQL]);
  }
  psql(['-c', ORDER_DUMP_TRUNCATE_SQL]);
  psql(['-f', sqlPath]);
  return inspection;
}

export function catalogFromProducts(products) {
  return {
    skus: new Set(products.map((product) => product.main_sku)),
    idBySku: new Map(products.map((product) => [product.main_sku, Number(product.id)])),
    skuById: new Map(products.map((product) => [Number(product.id), product.main_sku])),
  };
}

export async function remapImportedListingsToExcel(db, { trustProductId = false } = {}) {
  const products = (await db.query('select id, main_sku from products')).rows;
  const catalog = catalogFromProducts(products);
  const listings = (await db.query(
    'select id, product_id, seller_sku, shop_sku from product_listings',
  )).rows;
  let remapped = 0;
  for (const listing of listings) {
    const plan = planListingExcelRemap(listing, catalog, { trustProductId });
    if (!plan) continue;
    await db.query(
      'update product_listings set product_id=$2, updated_at=now() where id=$1',
      [plan.listingId, plan.productId],
    );
    remapped += 1;
  }
  return remapped;
}

export async function remapImportedItemHints(db, since = SALES_HISTORY_SINCE) {
  const products = (await db.query('select id, main_sku from products')).rows;
  const skus = new Set(products.map((product) => product.main_sku));
  const idBySku = new Map(products.map((product) => [product.main_sku, Number(product.id)]));
  const items = (await db.query(
    `select oi.id, oi.sku, oi.provider_sku, oi.main_sku
       from order_items oi
       join orders o on o.id = oi.order_id
       join order_channel_accounts a on a.id = o.channel_account_id
       join order_channels ch on ch.id = a.channel_id
      where ch.code = any($1::text[])
        and o.ordered_at >= $2::timestamptz
      order by oi.id`,
    [MAPPING_CHANNELS, since],
  )).rows;
  let remapped = 0;
  for (const item of items) {
    const master = listingMasterSku({
      sellerSku: item.sku,
      shopSku: item.provider_sku,
      productSku: item.main_sku,
    }, skus);
    if (master) await ensureAnchorProduct(db, master, skus, idBySku);
    await db.query(
      `update order_items
          set product_id = null, listing_id = null, main_sku = $2, updated_at = now()
        where id = $1`,
      [item.id, master],
    );
    remapped += 1;
  }
  return remapped;
}

export async function clearImportedItemProductLinks(db, since = SALES_HISTORY_SINCE) {
  return remapImportedItemHints(db, since);
}

export { excelMasterForSku, planListingExcelRemap };
