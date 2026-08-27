import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import {
  INVENTORY_COUNT_MASTER_SKUS,
  INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY,
  loadInventoryCount20260821,
} from './lib/inventory-count-2026-08-21.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    apply: { type: 'boolean', default: false },
    excel: { type: 'string' },
    'skip-sync': { type: 'boolean', default: false },
  },
});

config({ path: resolve('.env') });

const OPENING_REASON = 'Saldo inicial de agosto reconstruido desde el conteo físico';
const CANDIDATE_EXCEL_PATHS = [
  values.excel,
  process.env.INVENTORY_COUNT_XLSX,
  positionals[0],
  'stock 21.08.2026 a las 2.50 pm.xlsx',
  '/opt/cursor/uploads/stock 21.08.2026 a las 2.50 pm.xlsx',
  '/tmp/stock 21.08.2026 a las 2.50 pm.xlsx',
].filter(Boolean).map((path) => resolve(path));

function findExcel() {
  return CANDIDATE_EXCEL_PATHS.find((path) => existsSync(path)) || null;
}

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

async function writeSellerKeys(db) {
  const falabellaUser = String(process.env.FALABELLA_API_USER_ID || '').trim();
  const falabellaKey = String(process.env.FALABELLA_API_KEY || '').trim();
  const ripleyKey = String(process.env.RIPLEY_API_KEY || '').trim();
  const ripleyShop = String(process.env.RIPLEY_SHOP_ID || '').trim();
  if (!falabellaUser && !falabellaKey && !ripleyKey) {
    return { falabella: false, ripley: false };
  }
  await db.query(
    `update companies set
       falabella_api_user_id = coalesce(nullif($1,''), falabella_api_user_id),
       falabella_api_key = coalesce(nullif($2,''), falabella_api_key),
       ripley_api_key = coalesce(nullif($3,''), ripley_api_key),
       ripley_shop_id = coalesce(nullif($4,''), ripley_shop_id)
     where ruc='20990001001'`,
    [falabellaUser, falabellaKey, ripleyKey, ripleyShop],
  );
  await db.query(
    `insert into ripley_sync_state (company_id, enabled)
     select id, true from companies where ruc='20990001001'
     on conflict (company_id) do update set enabled=true, updated_at=now()`,
  );
  return { falabella: Boolean(falabellaUser && falabellaKey), ripley: Boolean(ripleyKey) };
}

async function seedCount(db, workbook) {
  for (const target of workbook.targets) {
    await db.query(
      `insert into products (main_sku, name, status, attributes)
       values ($1,$1,'active',$2)
       on conflict (main_sku) do update
         set status='active', attributes=excluded.attributes, updated_at=now()`,
      [target.masterSku, JSON.stringify({ source: 'excel_count_2026_08_21' })],
    );
  }
  for (const sku of INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY) {
    await db.query(
      `insert into products (main_sku, name, status, attributes)
       values ($1,$1,'active',$2)
       on conflict (main_sku) do update
         set status='active', attributes=excluded.attributes, updated_at=now()`,
      [sku, JSON.stringify({ source: 'excel_count_2026_08_21' })],
    );
    await db.query(
      `insert into product_inventory (product_id, quantity_on_hand, quantity_reserved)
       select id, 0, 0 from products where main_sku=$1
       on conflict (product_id) do update set quantity_on_hand=0, quantity_reserved=0, updated_at=now()`,
      [sku],
    );
  }
  for (const target of workbook.targets) {
    await db.query(
      `insert into product_inventory (product_id, quantity_on_hand, quantity_reserved)
       select id, $2, 0 from products where main_sku=$1
       on conflict (product_id) do update set quantity_on_hand=$2, quantity_reserved=0, updated_at=now()`,
      [target.masterSku, target.targetQuantity],
    );
    await db.query(
      `delete from inventory_movements
       where idempotency_key=$1`,
      [`excel-local-opening:${target.masterSku}`],
    );
    if (target.targetQuantity > 0) {
      await db.query(
        `insert into inventory_movements (
           product_id, movement_type, quantity_delta, quantity_after, reason,
           source, idempotency_key, metadata, effective_at
         )
         select p.id, 'initial', $2, $2, $3, 'excel_count', $4, $5::jsonb, $6
         from products p where p.main_sku=$1`,
        [
          target.masterSku,
          target.targetQuantity,
          OPENING_REASON,
          `excel-local-opening:${target.masterSku}`,
          JSON.stringify({ sourceHash: workbook.sourceHash, cutoffAt: PHYSICAL_COUNT_CUTOFF }),
          '2026-08-01T05:00:00.000Z',
        ],
      );
    }
  }
}

function monthsFromMay(now = new Date()) {
  const months = [];
  let year = 2026;
  let month = 5;
  const endYear = now.getUTCFullYear();
  const endMonth = now.getUTCMonth() + 1;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

async function companiesWithKeys(db) {
  const rows = (await db.query(
    `select id,
       nullif(trim(falabella_api_user_id),'') is not null
         and nullif(trim(falabella_api_key),'') is not null as falabella,
       nullif(trim(ripley_api_key),'') is not null as ripley
     from companies where activo is not false
     order by id`,
  )).rows;
  return rows.map((row) => ({
    id: Number(row.id),
    falabella: row.falabella === true,
    ripley: row.ripley === true,
  }));
}

async function syncMarketplaces(db) {
  const { drainMissingFalabellaOrderItems, syncFalabellaOrders } = await import('../packages/server/src/falabella-sync.js');
  const { syncRipleyOrders } = await import('../packages/server/src/ripley-orders.js');
  const months = monthsFromMay();
  const summary = [];
  for (const company of await companiesWithKeys(db)) {
    const entry = { companyId: company.id, falabella: [], ripley: null, items: null };
    if (company.falabella) {
      for (const month of months) {
        const result = await syncFalabellaOrders(company.id, { mode: 'month', month });
        entry.falabella.push({
          month,
          status: result.status,
          received: result.received,
          upserted: result.upserted,
        });
      }
      entry.items = await drainMissingFalabellaOrderItems(company.id);
    }
    if (company.ripley) {
      await db.query(
        `insert into ripley_sync_state (company_id, enabled)
         values ($1, true)
         on conflict (company_id) do update set enabled=true, updated_at=now()`,
        [company.id],
      );
      entry.ripley = await syncRipleyOrders(company.id, { startUpdateDate: SALES_HISTORY_SINCE });
    }
    summary.push(entry);
  }
  return summary;
}

const excelPath = findExcel();
if (!excelPath) {
  console.error('Falta el Excel del viernes (stock 21.08.2026 a las 2.50 pm.xlsx).');
  process.exit(1);
}

try {
  const workbook = loadInventoryCount20260821(excelPath);
  const countedUnits = workbook.targets.reduce((sum, target) => sum + target.targetQuantity, 0);
  console.log(`Excel: ${basename(excelPath)}`);
  console.log(`SHA-256: ${workbook.sourceHash}`);
  console.log(`Maestros contados: ${workbook.targets.length}; unidades: ${countedUnits}`);
  console.log(`Sin cantidad: ${[...INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY].join(', ')}`);
  console.log(`Corte: ${PHYSICAL_COUNT_CUTOFF}`);

  const keys = await writeSellerKeys(pool);
  await pool.query(
    `delete from inventory_movements
     where source in ('historical_sales_mapping', 'excel_count')
        or idempotency_key like 'excel-local-opening:%'
        or idempotency_key like 'historical-sales-mapping:%'`,
  );
  await pool.query(
    `delete from order_items where order_id in (
       select id from orders where external_order_id like 'EXCEL-MAP-%' or external_order_id like 'MAP-%')`,
  );
  await pool.query(
    `delete from orders where external_order_id like 'EXCEL-MAP-%' or external_order_id like 'MAP-%'`,
  );
  await seedCount(pool, workbook);

  const keyed = await companiesWithKeys(pool);
  if (!values['skip-sync'] && keyed.some((company) => company.falabella || company.ripley)) {
    const sync = await syncMarketplaces(pool);
    console.log('Sync:', JSON.stringify(sync.map((entry) => ({
      companyId: entry.companyId,
      falabella: entry.falabella,
      items: entry.items,
      ripley: entry.ripley && { status: entry.ripley.status, received: entry.ripley.received },
    }))));
  } else if (keys.falabella || keys.ripley) {
    console.log('Se escribieron API keys pero ninguna empresa quedó con credenciales usable.');
  } else {
    console.log('Sin API keys de seller: no se sincronizaron pedidos Falabella/Ripley.');
  }

  const loaded = await loadHistoricalSalesMappingContext(pool, { since: SALES_HISTORY_SINCE });
  const coverage = buildHistoricalSalesCoverage({
    ...loaded,
    countedSkus: INVENTORY_COUNT_MASTER_SKUS,
    skusWithoutQuantity: INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY,
    since: SALES_HISTORY_SINCE,
  });
  console.table([coverage.summary]);

  mkdirSync(resolve('.audit'), { recursive: true });
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  const reviewTsv = formatReviewTsv(coverage.identities);
  const reportTsv = formatCoverageTsv(coverage.identities);
  writeFileSync(resolve('.audit/sales-mapping-since-may-2026-review.tsv'), reviewTsv);
  writeFileSync(resolve('.audit/sales-mapping-since-may-2026.tsv'), reportTsv);
  writeFileSync('/opt/cursor/artifacts/sales-mapping-review.tsv', reviewTsv);
  writeFileSync('/opt/cursor/artifacts/sales-mapping-report.tsv', reportTsv);
  console.log(`Revisión: ${coverage.review.length} identidades`);

  if (!values.apply) {
    console.log('DRY RUN: no se asociaron líneas ni se descontó stock. Usa --apply.');
  } else {
    const result = await applyHistoricalSalesMappings(pool, {
      since: SALES_HISTORY_SINCE,
      countedSkus: INVENTORY_COUNT_MASTER_SKUS,
      skusWithoutQuantity: INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY,
    });
    console.log(`APLICADO: mapped ${result.updatedItems}, deducted ${result.deductedItems}, shortages ${result.shortages.length}`);
  }
} finally {
  await pool.end();
}
