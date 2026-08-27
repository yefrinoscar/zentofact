import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import {
  INVENTORY_COUNT_MASTER_SKUS,
  INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY,
} from './lib/inventory-count-2026-08-21.mjs';

config({ path: resolve('.env') });

const COUNT_QTY = 10;
const PREFIX = 'EXCEL-MAP';
const {
  SALES_HISTORY_SINCE,
  PHYSICAL_COUNT_CUTOFF,
  applyHistoricalSalesMappings,
  buildHistoricalSalesCoverage,
  formatCoverageTsv,
  formatReviewTsv,
  loadHistoricalSalesMappingContext,
} = await import('../packages/server/src/catalog/historical-sales-mapping.js');
const { pool } = await import('@zentofact/core');

const excelIds = [...INVENTORY_COUNT_MASTER_SKUS].sort();
const noQty = [...INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY].sort();

async function ensureCompanyAndAccounts(db) {
  const existing = await db.query(`select id from companies where ruc='20990001001' order by id limit 1`);
  const company = existing.rows[0] || (await db.query(
    `insert into companies (nombre, ruc, razon_social, nombre_comercial, activo)
     values ('LIMBO', '20990001001', 'LIMBO SAC', 'LIMBO', true) returning id`,
  )).rows[0];
  const companyId = Number(company.id);
  for (const code of ['falabella', 'ripley']) {
    await db.query(
      `insert into order_channel_accounts (
         company_id, channel_id, external_account_id, display_name,
         auto_create_orders, document_requirement, document_type_policy, settings
       )
       select $1, ch.id, 'default', $2, true, 'optional', 'automatic', '{}'::jsonb
       from order_channels ch where ch.code=$3
       on conflict (company_id, channel_id, external_account_id) do nothing`,
      [companyId, `LIMBO ${code}`, code],
    );
  }
  return companyId;
}

async function seedExcelProducts(db) {
  for (const mainSku of [...excelIds, ...noQty]) {
    await db.query(
      `insert into products (main_sku, name, status, attributes)
       values ($1,$1,'active',$2)
       on conflict (main_sku) do update set status='active', updated_at=now()`,
      [mainSku, JSON.stringify({ source: 'excel_count_2026_08_21' })],
    );
    const counted = INVENTORY_COUNT_MASTER_SKUS.has(mainSku);
    await db.query(
      `insert into product_inventory (product_id, quantity_on_hand, quantity_reserved)
       select id, $2, 0 from products where main_sku=$1
       on conflict (product_id) do update set quantity_on_hand=$2, quantity_reserved=0, updated_at=now()`,
      [mainSku, counted ? COUNT_QTY : 0],
    );
  }
}

async function listing(db, companyId, channel, sellerSku, mainSku) {
  await db.query(
    `insert into product_listings (
       product_id, channel_code, company_id, channel_account_id, seller_sku, shop_sku,
       title, status, marketplace_quantity, metadata
     )
     select p.id, $1, $2, a.id, $3, $3, p.name, 'active', $5, '{}'::jsonb
     from products p
     join order_channels ch on ch.code=$1
     join order_channel_accounts a on a.company_id=$2 and a.channel_id=ch.id
     where p.main_sku=$4
     on conflict (channel_code, company_id, seller_sku) do update
       set product_id=excluded.product_id, status='active', updated_at=now()`,
    [channel, companyId, sellerSku, mainSku, COUNT_QTY],
  );
}

async function insertOrder(db, companyId, channel, externalId, orderedAt, sku, shopSku, qty) {
  const order = await db.query(
    `insert into orders (
       company_id, channel_account_id, external_order_id, external_order_number,
       order_status, payment_status, fulfillment_status, document_status,
       document_requirement, document_type_policy, items_status, ordered_at
     )
     select $1, a.id, $2, $2, 'confirmed', 'paid', 'shipped', 'not_requested',
       'optional', 'automatic', 'complete', $3
     from order_channel_accounts a
     join order_channels ch on ch.id=a.channel_id
     where a.company_id=$1 and ch.code=$4
     on conflict (channel_account_id, external_order_id) do update
       set ordered_at=excluded.ordered_at, fulfillment_status='shipped', items_status='complete'
     returning id`,
    [companyId, externalId, orderedAt, channel],
  );
  await db.query(
    `insert into order_items (order_id, external_item_id, sku, provider_sku, description, quantity,
       product_id, listing_id, main_sku, stock_state, stock_applied_quantity)
     values ($1,'1',$2,$3,$2,$4,null,null,null,'none',0)
     on conflict (order_id, external_item_id) do update
       set sku=excluded.sku, provider_sku=excluded.provider_sku, quantity=excluded.quantity,
           product_id=null, listing_id=null, main_sku=null, stock_state='none', stock_applied_quantity=0`,
    [order.rows[0].id, sku, shopSku, qty],
  );
}

async function resetExcelSales(db) {
  await db.query(
    `delete from inventory_movements
     where source='historical_sales_mapping'
        or idempotency_key like 'historical-sales-mapping:%'
        or idempotency_key like 'excel-local-opening:%'`,
  );
  await db.query(
    `delete from order_items where order_id in (
       select id from orders where external_order_id like $1)`,
    [`${PREFIX}-%`],
  );
  await db.query(`delete from orders where external_order_id like $1`, [`${PREFIX}-%`]);
}

try {
  const companyId = await ensureCompanyAndAccounts(pool);
  await seedExcelProducts(pool);
  await listing(pool, companyId, 'falabella', 'Z7', 'Z7');
  await listing(pool, companyId, 'falabella', 'AG174', 'Z7');
  await listing(pool, companyId, 'ripley', 'HOG025', 'HOG025');
  await listing(pool, companyId, 'falabella', 'AG301', 'G35V');
  await listing(pool, companyId, 'falabella', 'G40XL', 'G40XL');
  await resetExcelSales(pool);
  await seedExcelProducts(pool);

  await insertOrder(pool, companyId, 'falabella', `${PREFIX}-Z7-PRE`, '2026-08-10T12:00:00Z', 'AG174', 'AG174', 3);
  await insertOrder(pool, companyId, 'falabella', `${PREFIX}-Z7-POST`, '2026-08-22T16:00:00Z', 'Z7', 'Z7', 2);
  await insertOrder(pool, companyId, 'ripley', `${PREFIX}-HOG025-POST`, '2026-08-22T16:30:00Z', 'HOG025', 'HOG025', 1);
  await insertOrder(pool, companyId, 'falabella', `${PREFIX}-G35V-POST`, '2026-08-22T17:00:00Z', 'AG301', 'AG301', 1);
  await insertOrder(pool, companyId, 'falabella', `${PREFIX}-G40XL-POST`, '2026-08-22T18:00:00Z', 'G40XL', 'G40XL', 1);
  await insertOrder(pool, companyId, 'falabella', `${PREFIX}-UNKNOWN`, '2026-08-22T19:00:00Z', 'NO-EXISTE', '000', 1);

  const loaded = await loadHistoricalSalesMappingContext(pool, { since: SALES_HISTORY_SINCE });
  const coverage = buildHistoricalSalesCoverage({
    ...loaded,
    countedSkus: INVENTORY_COUNT_MASTER_SKUS,
    skusWithoutQuantity: INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY,
  });
  const result = await applyHistoricalSalesMappings(pool, {
    since: SALES_HISTORY_SINCE,
    countedSkus: INVENTORY_COUNT_MASTER_SKUS,
    skusWithoutQuantity: INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY,
  });

  const stock = await pool.query(
    `select p.main_sku, i.quantity_on_hand
     from products p join product_inventory i on i.product_id=p.id
     where p.main_sku=any($1) order by p.main_sku`,
    [['Z7', 'HOG025', 'G35V', 'G40XL']],
  );
  const items = await pool.query(
    `select o.external_order_id, oi.sku, oi.main_sku, oi.stock_state, oi.stock_applied_quantity
     from order_items oi join orders o on o.id=oi.order_id
     where o.external_order_id like $1 order by o.external_order_id`,
    [`${PREFIX}-%`],
  );
  const bySku = Object.fromEntries(stock.rows.map((row) => [row.main_sku, Number(row.quantity_on_hand)]));
  const expected = { Z7: 8, HOG025: 9, G35V: 9, G40XL: 0 };
  const mismatches = Object.entries(expected).filter(([sku, qty]) => bySku[sku] !== qty);

  mkdirSync(resolve('.audit'), { recursive: true });
  writeFileSync(resolve('.audit/sales-mapping-since-may-2026-review.tsv'), formatReviewTsv(coverage.identities));
  writeFileSync(resolve('.audit/sales-mapping-since-may-2026.tsv'), formatCoverageTsv(coverage.identities));

  console.log(`Excel product IDs in catalog: ${excelIds.length} counted + ${noQty.length} without quantity`);
  console.log(`Cutoff: ${PHYSICAL_COUNT_CUTOFF}`);
  console.table([coverage.summary]);
  console.table(stock.rows);
  console.table(items.rows);
  console.log(`APLICADO: mapped ${result.updatedItems}, deducted ${result.deductedItems}`);
  if (mismatches.length) {
    throw new Error(`Stock mismatch: ${mismatches.map(([sku, qty]) => `${sku} expected ${qty} got ${bySku[sku]}`).join('; ')}`);
  }
  const unknown = items.rows.find((row) => row.external_order_id.endsWith('UNKNOWN'));
  if (unknown?.main_sku) throw new Error('NO-EXISTE no debe mapearse.');
  const pre = items.rows.find((row) => row.external_order_id.endsWith('Z7-PRE'));
  if (pre.main_sku !== 'Z7' || Number(pre.stock_applied_quantity) !== 0) {
    throw new Error('La venta anterior al conteo debe mapear a Z7 sin descontar.');
  }
  console.log('LOCAL PROVE: excel IDs, post-count deductions, and review list match.');
} finally {
  await pool.end();
}
