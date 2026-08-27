import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import {
  INVENTORY_COUNT_MASTER_SKUS,
  INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY,
  loadInventoryCount20260821,
} from './lib/inventory-count-2026-08-21.mjs';
import { discoverSalesMappingInputs } from '../packages/server/src/catalog/find-sales-mapping-inputs.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    apply: { type: 'boolean', default: false },
    excel: { type: 'string' },
    bundle: { type: 'string' },
    'orders-sql': { type: 'string' },
    'skip-sync': { type: 'boolean', default: false },
  },
});

config({ path: resolve('.env') });
mkdirSync('/opt/cursor/uploads', { recursive: true });
mkdirSync('/opt/cursor/artifacts', { recursive: true });

const OPENING_REASON = 'Saldo inicial de agosto reconstruido desde el conteo físico';
const SOURCE_BUNDLE_PATH = '/opt/cursor/uploads/sales-mapping-bundle.json';

const {
  SALES_HISTORY_SINCE,
  PHYSICAL_COUNT_CUTOFF,
  ORDER_SINCE_SQL,
  applyHistoricalSalesMappings,
  buildHistoricalSalesCoverage,
  formatCoverageTsv,
  formatReviewTsv,
  formatShortagesTsv,
  loadHistoricalSalesMappingContext,
} = await import('../packages/server/src/catalog/historical-sales-mapping.js');
const {
  EXPORT_ORDERS_DUMP_COMMAND,
  remapImportedItemHints,
  remapImportedListingsToExcel,
  restoreOrdersDump,
} = await import('../packages/server/src/catalog/import-orders-since-may.js');
const {
  EXPORT_SALES_MAPPING_BUNDLE_COMMAND,
  EXPORT_SALES_MAPPING_BUNDLE_REMOTE_COMMAND,
  assertBundleWorkbook,
  ingestSalesMappingBundle,
  hydrateUnifiedOrdersFromFalabellaInbox,
  parseSalesMappingBundle,
  workbookFromBundleExcel,
} = await import('../packages/server/src/catalog/sales-mapping-bundle.js');
const {
  exportSalesMappingBundleViaPsql,
  resolveMarketplaceKeyTargets,
  salesMappingApplyGate,
  seedExcelIdentityCatalog,
  seedHistoricalMastersAbsentFromExcel,
  writeMarketplaceSyncKeys,
} = await import('../packages/server/src/catalog/sales-mapping-apply.js');
const { pool } = await import('@zentofact/core');
const databaseUrl = process.env.DATABASE_URL_POSTGRES || process.env.DATABASE_URL;
const sourceDatabaseUrl = String(process.env.SALES_MAPPING_SOURCE_DATABASE_URL || '').trim();
if (sourceDatabaseUrl && sourceDatabaseUrl !== databaseUrl) {
  console.log('Exportando bundle desde SALES_MAPPING_SOURCE_DATABASE_URL (solo lectura).');
  try {
    exportSalesMappingBundleViaPsql({
      databaseUrl: sourceDatabaseUrl,
      sqlPath: resolve('scripts/export-sales-mapping-bundle.sql'),
      outputPath: SOURCE_BUNDLE_PATH,
    });
    parseSalesMappingBundle(readFileSync(SOURCE_BUNDLE_PATH, 'utf8'));
  } catch (error) {
    console.error('No se pudo leer la base operativa:', error.message);
    process.exit(1);
  }
} else if (sourceDatabaseUrl && sourceDatabaseUrl === databaseUrl) {
  console.error('SALES_MAPPING_SOURCE_DATABASE_URL no puede ser esta misma base: aquí no está el conteo del viernes.');
  process.exit(1);
}

const discovered = discoverSalesMappingInputs({
  excel: values.excel || process.env.INVENTORY_COUNT_XLSX || positionals[0],
  bundle: values.bundle
    || process.env.SALES_MAPPING_BUNDLE
    || (sourceDatabaseUrl ? SOURCE_BUNDLE_PATH : undefined),
  ordersSql: values['orders-sql'] || process.env.ORDERS_SINCE_MAY_SQL,
});

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

async function companiesWithKeys(db, rucs = null) {
  const rows = (await db.query(
    `select id,
       nullif(trim(falabella_api_user_id),'') is not null
         and nullif(trim(falabella_api_key),'') is not null as falabella,
       nullif(trim(ripley_api_key),'') is not null as ripley
     from companies
     where activo is not false
       and ($1::text[] is null or ruc = any($1::text[]))
     order by id`,
    [rucs],
  )).rows;
  return rows.map((row) => ({
    id: Number(row.id),
    falabella: row.falabella === true,
    ripley: row.ripley === true,
  })).filter((row) => row.falabella || row.ripley);
}

async function syncMarketplaces(db, companies = null) {
  const { drainMissingFalabellaOrderItems, syncFalabellaOrders } = await import('../packages/server/src/falabella-sync.js');
  const { drainMissingRipleyOrderItems, syncRipleyOrders } = await import('../packages/server/src/ripley-orders.js');
  const months = monthsFromMay();
  const summary = [];
  for (const company of companies || await companiesWithKeys(db)) {
    const entry = { companyId: company.id, falabella: [], ripley: null, items: null, ripleyItems: null };
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
      entry.items = await drainMissingFalabellaOrderItems(company.id, {
        includeEmptyPayloads: true,
        includeCancelled: true,
        since: SALES_HISTORY_SINCE,
      });
    }
    if (company.ripley) {
      await db.query(
        `insert into ripley_sync_state (company_id, enabled)
         values ($1, true)
         on conflict (company_id) do update set enabled=true, updated_at=now()`,
        [company.id],
      );
      entry.ripley = await syncRipleyOrders(company.id, { startUpdateDate: SALES_HISTORY_SINCE });
      entry.ripleyItems = await drainMissingRipleyOrderItems(company.id, { since: SALES_HISTORY_SINCE });
    }
    summary.push(entry);
  }
  return summary;
}

const excelPath = discovered.excel;
const bundlePath = discovered.bundle;
const bundle = bundlePath
  ? parseSalesMappingBundle(readFileSync(bundlePath, 'utf8'))
  : null;
const workbook = excelPath
  ? loadInventoryCount20260821(excelPath)
  : bundle
    ? assertBundleWorkbook(workbookFromBundleExcel(bundle.excel))
    : null;

try {
  if (workbook) {
    const countedUnits = workbook.targets.reduce((sum, target) => sum + target.targetQuantity, 0);
    if (excelPath) console.log(`Excel: ${basename(excelPath)}`);
    if (bundlePath) console.log(`Bundle: ${basename(bundlePath)}`);
    console.log(`SHA-256: ${workbook.sourceHash || '(bundle)'}`);
    console.log(`Maestros contados: ${workbook.targets.length}; unidades: ${countedUnits}`);
    console.log(`Sin cantidad: ${[...INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY].join(', ')}`);
    console.log(`Corte: ${PHYSICAL_COUNT_CUTOFF}`);
  } else {
    console.error('Falta el Excel del viernes o un sales-mapping-bundle.json con esas cantidades.');
    console.error('En la base operativa (con el repo):');
    console.error(EXPORT_SALES_MAPPING_BUNDLE_COMMAND);
    console.error('O sin clonar, desde esa misma base:');
    console.error(EXPORT_SALES_MAPPING_BUNDLE_REMOTE_COMMAND);
    console.log('Se mapean ventas si hay API keys o un dump; el descuento espera el conteo.');
  }

  const dumpPath = discovered.ordersSql;
  if (dumpPath && !bundle) {
    console.log(`Importando pedidos ${basename(dumpPath)}`);
    restoreOrdersDump({ sqlPath: dumpPath, databaseUrl });
  } else if (!bundle && !dumpPath) {
    console.log('Sin bundle ni dump de pedidos Falabella/Ripley. En la base operativa:');
    console.log(EXPORT_SALES_MAPPING_BUNDLE_COMMAND);
    console.log(EXPORT_SALES_MAPPING_BUNDLE_REMOTE_COMMAND);
    console.log(EXPORT_ORDERS_DUMP_COMMAND);
  }

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
  if (workbook) await seedCount(pool, workbook);
  await seedExcelIdentityCatalog(pool, {
    countedSkus: INVENTORY_COUNT_MASTER_SKUS,
    skusWithoutQuantity: INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY,
  });
  const absentMasters = await seedHistoricalMastersAbsentFromExcel(pool, {
    countedSkus: INVENTORY_COUNT_MASTER_SKUS,
    skusWithoutQuantity: INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY,
  });
  if (absentMasters.length) {
    console.log(`Maestros históricos ausentes del Excel (se asocian, no se descuentan): ${absentMasters.join(', ')}`);
  }

  if (bundle) {
    const ingested = await ingestSalesMappingBundle(pool, bundle);
    console.log(`Bundle ingerido: ${ingested.orders} pedidos, ${ingested.items} líneas, ${ingested.listings} listings, ${ingested.events} eventos.`);
  } else if (dumpPath) {
    const remapped = await remapImportedListingsToExcel(pool);
    const hydrated = await hydrateUnifiedOrdersFromFalabellaInbox(pool);
    const hinted = await remapImportedItemHints(pool);
    console.log(`Listings reasociados a IDs del Excel: ${remapped}; líneas con maestro operativo: ${hinted}; inbox Falabella: ${hydrated.items} líneas.`);
  }

  const keyTargets = resolveMarketplaceKeyTargets({
    falabellaCompanyRuc: process.env.FALABELLA_COMPANY_RUC,
    ripleyCompanyRuc: process.env.RIPLEY_COMPANY_RUC,
    bundle,
  });
  if (keyTargets.ambiguousFalabella) {
    console.error(`Hay varias empresas Falabella (${keyTargets.falabellaFromBundle.join(', ')}). Define FALABELLA_COMPANY_RUC.`);
  }
  if (keyTargets.ambiguousRipley) {
    console.error(`Hay varias empresas Ripley (${keyTargets.ripleyFromBundle.join(', ')}). Define RIPLEY_COMPANY_RUC.`);
  }
  const keys = await writeMarketplaceSyncKeys(pool, {
    falabellaUser: process.env.FALABELLA_API_USER_ID,
    falabellaKey: process.env.FALABELLA_API_KEY,
    ripleyKey: process.env.RIPLEY_API_KEY,
    ripleyShop: process.env.RIPLEY_SHOP_ID,
    falabellaRucs: keyTargets.falabellaRucs,
    ripleyRucs: keyTargets.ripleyRucs,
  });
  if (keys.falabella) console.log(`Keys Falabella en RUC ${keys.falabellaRucs.join(', ')}`);
  if (keys.ripley) console.log(`Keys Ripley en RUC ${keys.ripleyRucs.join(', ')}`);

  const keyed = await companiesWithKeys(pool, [...new Set([...keys.falabellaRucs, ...keys.ripleyRucs])]);
  if (!values['skip-sync'] && keyed.length) {
    const sync = await syncMarketplaces(pool, keyed);
    console.log('Sync:', JSON.stringify(sync.map((entry) => ({
      companyId: entry.companyId,
      falabella: entry.falabella,
      items: entry.items,
      ripley: entry.ripley && { status: entry.ripley.status, received: entry.ripley.received },
      ripleyItems: entry.ripleyItems,
    }))));
  } else if (keys.falabella || keys.ripley) {
    console.log('Se escribieron API keys pero ninguna empresa quedó con credenciales usable.');
  } else {
    console.log('Sin acceso a Falabella ni Ripley: faltan FALABELLA_API_USER_ID/FALABELLA_API_KEY y RIPLEY_API_KEY.');
  }

  const realOrders = Number((await pool.query(
    `select count(*)::int as n
     from orders o
     join order_channel_accounts a on a.id = o.channel_account_id
     join order_channels ch on ch.id = a.channel_id
     where ch.code = any($1::text[])
       and ${ORDER_SINCE_SQL} >= $2
       and o.external_order_id not like 'EXCEL-MAP-%'
       and o.external_order_id not like 'MAP-%'`,
    [['falabella', 'ripley'], SALES_HISTORY_SINCE],
  )).rows[0]?.n || 0);
  if (realOrders === 0) {
    console.error('No hay pedidos Falabella/Ripley reales desde mayo en esta base.');
    console.error('Falta el sales-mapping-bundle.json, un dump de pedidos, o las API keys de seller.');
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
  const shortagesTsv = formatShortagesTsv(coverage.shortages);
  writeFileSync(resolve('.audit/sales-mapping-since-may-2026-review.tsv'), reviewTsv);
  writeFileSync(resolve('.audit/sales-mapping-since-may-2026.tsv'), reportTsv);
  writeFileSync(resolve('.audit/sales-mapping-since-may-2026-shortages.tsv'), shortagesTsv);
  writeFileSync('/opt/cursor/artifacts/sales-mapping-review.tsv', reviewTsv);
  writeFileSync('/opt/cursor/artifacts/sales-mapping-report.tsv', reportTsv);
  writeFileSync('/opt/cursor/artifacts/sales-mapping-shortages.tsv', shortagesTsv);
  console.log(`Revisión: ${coverage.review.length} identidades; faltantes de stock: ${coverage.shortages.length}`);

  const gate = salesMappingApplyGate({
    workbook,
    realOrders,
    apply: values.apply,
  });
  if (!gate.ok) {
    console.error(gate.message);
    if (values.apply) process.exit(1);
    console.log('DRY RUN: no se asociaron líneas ni se descontó stock.');
  } else if (!values.apply) {
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
