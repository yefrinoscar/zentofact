import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import {
  HISTORICAL_SKU_TO_MASTER,
  historicalMastersAbsentFromExcel,
} from './historical-sku-map.js';

export const SEED_LIMBO_RUC = '20990001001';

function uniqueChannelRucs(bundle, channel) {
  const rucs = new Set();
  for (const order of bundle?.orders || []) {
    if (order.channel === channel && order.companyRuc) rucs.add(String(order.companyRuc).trim());
  }
  for (const listing of bundle?.listings || []) {
    if (listing.channel === channel && listing.companyRuc) rucs.add(String(listing.companyRuc).trim());
  }
  return [...rucs].filter(Boolean).sort();
}

export function resolveMarketplaceKeyTargets({
  falabellaCompanyRuc,
  ripleyCompanyRuc,
  bundle,
  fallbackRuc = SEED_LIMBO_RUC,
} = {}) {
  const falabellaFromBundle = uniqueChannelRucs(bundle, 'falabella');
  const ripleyFromBundle = uniqueChannelRucs(bundle, 'ripley');
  const explicitFalabella = String(falabellaCompanyRuc || '').trim();
  const explicitRipley = String(ripleyCompanyRuc || '').trim();
  const ambiguousFalabella = !explicitFalabella && falabellaFromBundle.length > 1;
  const ambiguousRipley = !explicitRipley && ripleyFromBundle.length > 1;
  const falabellaRucs = explicitFalabella
    ? [explicitFalabella]
    : ambiguousFalabella
      ? []
      : falabellaFromBundle.length === 1
        ? falabellaFromBundle
        : [fallbackRuc];
  const ripleyRucs = explicitRipley
    ? [explicitRipley]
    : ambiguousRipley
      ? []
      : ripleyFromBundle.length === 1
        ? ripleyFromBundle
        : falabellaRucs;
  return {
    falabellaRucs,
    ripleyRucs,
    ambiguousFalabella,
    ambiguousRipley,
    falabellaFromBundle,
    ripleyFromBundle,
  };
}

export async function writeMarketplaceSyncKeys(db, {
  falabellaUser = '',
  falabellaKey = '',
  ripleyKey = '',
  ripleyShop = '',
  falabellaRucs = [],
  ripleyRucs = [],
} = {}) {
  const falUser = String(falabellaUser || '').trim();
  const falKey = String(falabellaKey || '').trim();
  const ripKey = String(ripleyKey || '').trim();
  const ripShop = String(ripleyShop || '').trim();
  if (!falUser && !falKey && !ripKey) {
    return { falabella: false, ripley: false, falabellaRucs: [], ripleyRucs: [] };
  }
  if ((falUser || falKey) && falabellaRucs.length) {
    await db.query(
      `update companies set
         falabella_api_user_id = coalesce(nullif($1,''), falabella_api_user_id),
         falabella_api_key = coalesce(nullif($2,''), falabella_api_key)
       where ruc = any($3::text[])`,
      [falUser, falKey, falabellaRucs],
    );
  }
  if (ripKey && ripleyRucs.length) {
    await db.query(
      `update companies set
         ripley_api_key = coalesce(nullif($1,''), ripley_api_key),
         ripley_shop_id = coalesce(nullif($2,''), ripley_shop_id)
       where ruc = any($3::text[])`,
      [ripKey, ripShop, ripleyRucs],
    );
    await db.query(
      `insert into ripley_sync_state (company_id, enabled)
       select id, true from companies where ruc = any($1::text[])
       on conflict (company_id) do update set enabled=true, updated_at=now()`,
      [ripleyRucs],
    );
  }
  return {
    falabella: Boolean(falUser && falKey && falabellaRucs.length),
    ripley: Boolean(ripKey && ripleyRucs.length),
    falabellaRucs,
    ripleyRucs,
  };
}

export async function seedHistoricalMastersAbsentFromExcel(db, {
  countedSkus,
  skusWithoutQuantity,
  historicalMap = HISTORICAL_SKU_TO_MASTER,
} = {}) {
  const catalog = new Set([...(countedSkus || []), ...(skusWithoutQuantity || [])]);
  const masters = historicalMastersAbsentFromExcel(catalog, historicalMap);
  for (const sku of masters) {
    await db.query(
      `insert into products (main_sku, name, status, attributes)
       values ($1,$1,'active',$2)
       on conflict (main_sku) do update
         set status='active', attributes=excluded.attributes, updated_at=now()`,
      [sku, JSON.stringify({ source: 'historical_master_absent_from_excel' })],
    );
    await db.query(
      `insert into product_inventory (product_id, quantity_on_hand, quantity_reserved)
       select id, 0, 0 from products where main_sku=$1
       on conflict (product_id) do update set quantity_on_hand=0, quantity_reserved=0, updated_at=now()`,
      [sku],
    );
  }
  return masters;
}

export function exportSalesMappingBundleViaPsql({
  databaseUrl,
  sqlPath,
  outputPath,
  execFile = execFileSync,
} = {}) {
  const url = String(databaseUrl || '').trim();
  if (!url) throw new Error('Falta SALES_MAPPING_SOURCE_DATABASE_URL.');
  const stdout = execFile('psql', [
    url,
    '-q',
    '-v', 'ON_ERROR_STOP=1',
    '-t',
    '-A',
    '-f', sqlPath,
  ], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  const text = String(stdout || '').trim();
  if (outputPath) writeFileSync(outputPath, `${text}\n`);
  return text;
}
