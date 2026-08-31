import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  INVENTORY_COUNT_MASTER_SKUS,
  INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY,
} from '../../../scripts/lib/inventory-count-2026-08-21.mjs';
import {
  exportSalesMappingBundleViaPsql,
  resolveMarketplaceKeyTargets,
  salesMappingApplyGate,
  seedExcelIdentityCatalog,
  seedHistoricalMastersAbsentFromExcel,
  writeMarketplaceSyncKeys,
} from './catalog/sales-mapping-apply.js';

test('las keys de seller van a un RUC explícito o a la única empresa del bundle', () => {
  const unique = resolveMarketplaceKeyTargets({
    bundle: {
      orders: [{ channel: 'falabella', companyRuc: '20607809136' }],
      listings: [{ channel: 'falabella', companyRuc: '20607809136' }],
    },
  });
  assert.deepEqual(unique.falabellaRucs, ['20607809136']);
  assert.equal(unique.ambiguousFalabella, false);

  const explicit = resolveMarketplaceKeyTargets({
    falabellaCompanyRuc: '20607809136',
    bundle: {
      orders: [
        { channel: 'falabella', companyRuc: '20607809136' },
        { channel: 'falabella', companyRuc: '20555666777' },
      ],
    },
  });
  assert.deepEqual(explicit.falabellaRucs, ['20607809136']);
  assert.equal(explicit.ambiguousFalabella, false);

  const ambiguous = resolveMarketplaceKeyTargets({
    bundle: {
      orders: [
        { channel: 'falabella', companyRuc: '20607809136' },
        { channel: 'falabella', companyRuc: '20555666777' },
      ],
    },
  });
  assert.deepEqual(ambiguous.falabellaRucs, []);
  assert.equal(ambiguous.ambiguousFalabella, true);

  const fallback = resolveMarketplaceKeyTargets({ bundle: { orders: [], listings: [] } });
  assert.deepEqual(fallback.falabellaRucs, ['20990001001']);
});

test('el export llama psql en solo lectura contra la URL operativa', () => {
  const calls = [];
  const text = exportSalesMappingBundleViaPsql({
    databaseUrl: 'postgresql://op@example/zentofact',
    sqlPath: '/tmp/export.sql',
    execFile(command, args, options) {
      calls.push({ command, args, options });
      return ' {"version":1} \n';
    },
  });
  assert.equal(text, '{"version":1}');
  assert.equal(calls[0].command, 'psql');
  assert.equal(calls[0].args[0], 'postgresql://op@example/zentofact');
  assert.ok(calls[0].args.includes('-f'));
  assert.ok(calls[0].args.includes('-q'));
  assert.throws(
    () => exportSalesMappingBundleViaPsql({ databaseUrl: '', sqlPath: '/tmp/export.sql' }),
    /SALES_MAPPING_SOURCE_DATABASE_URL/,
  );
});

test('se crean maestros históricos ausentes del Excel en stock 0', async () => {
  const inserted = [];
  const db = {
    async query(sql, params = []) {
      inserted.push({ sql: String(sql), params });
      return { rows: [], rowCount: 1 };
    },
  };
  const masters = await seedHistoricalMastersAbsentFromExcel(db, {
    countedSkus: INVENTORY_COUNT_MASTER_SKUS,
    skusWithoutQuantity: INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY,
  });
  assert.ok(masters.includes('AG227'));
  assert.ok(masters.includes('FAL-144958533'));
  assert.ok(masters.includes('AM7'));
  assert.equal(masters.includes('Z7'), false);
  assert.equal(masters.includes('AG107'), false);
  const productInsert = inserted.find((entry) => entry.sql.includes('insert into products') && entry.params[0] === 'AG227');
  assert.equal(JSON.parse(productInsert.params[1]).source, 'historical_master_absent_from_excel');
  const inventoryInsert = inserted.find((entry) => entry.sql.includes('product_inventory') && entry.params[0] === 'AG227');
  assert.ok(inventoryInsert);
});

test('el comando local de mapeo es JavaScript válido', () => {
  const script = resolve(dirname(fileURLToPath(import.meta.url)), '../../../scripts/apply-excel-count-and-map-sales-local.mjs');
  const result = spawnSync(process.execPath, ['--check', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('writeMarketplaceSyncKeys no adivina si no hay keys', async () => {
  const queries = [];
  const db = {
    async query(sql, params = []) {
      const text = String(sql);
      queries.push({ sql: text, params });
      if (text.includes('select id from companies')) return { rows: [{ id: 1 }] };
      if (text.includes('select id from order_channels')) return { rows: [{ id: 1 }] };
      if (text.includes('from order_channel_accounts')) return { rows: [{ id: 4 }] };
      return { rows: [], rowCount: 1 };
    },
  };
  const empty = await writeMarketplaceSyncKeys(db, {
    falabellaRucs: ['20607809136'],
  });
  assert.equal(empty.falabella, false);
  assert.equal(queries.length, 0);

  const written = await writeMarketplaceSyncKeys(db, {
    falabellaUser: 'user',
    falabellaKey: 'key',
    falabellaRucs: ['20607809136'],
  });
  assert.equal(written.falabella, true);
  const update = queries.find((entry) => entry.sql.includes('falabella_api_user_id'));
  assert.equal(update.params[2][0], '20607809136');
  assert.equal(queries.some((entry) => entry.sql.includes('insert into companies')), false);
});

test('writeMarketplaceSyncKeys crea la empresa si el RUC no existe', async () => {
  const queries = [];
  const db = {
    async query(sql, params = []) {
      const text = String(sql);
      queries.push({ sql: text, params });
      if (text.includes('select id from companies')) return { rows: [] };
      if (text.includes('insert into companies')) return { rows: [{ id: 9 }] };
      if (text.includes('select id from order_channels')) return { rows: [{ id: 1 }] };
      if (text.includes('from order_channel_accounts')) return { rows: [{ id: 4 }] };
      return { rows: [], rowCount: 1 };
    },
  };
  const written = await writeMarketplaceSyncKeys(db, {
    falabellaUser: 'user',
    falabellaKey: 'key',
    falabellaRucs: ['20607809136'],
  });
  assert.equal(written.falabella, true);
  assert.equal(queries.some((entry) => entry.sql.includes('insert into companies')), true);
  assert.equal(queries.some((entry) => entry.sql.includes('insert into order_channel_accounts')), true);
});

test('seedExcelIdentityCatalog no pisa cantidades ya contadas', async () => {
  const queries = [];
  const db = {
    async query(sql, params = []) {
      queries.push({ sql: String(sql), params });
      return { rows: [], rowCount: 1 };
    },
  };
  const skus = await seedExcelIdentityCatalog(db, {
    countedSkus: new Set(['Z7']),
    skusWithoutQuantity: new Set(['G40XL']),
  });
  assert.deepEqual(skus, ['G40XL', 'Z7']);
  assert.equal(queries.some((entry) => entry.sql.includes('on conflict (product_id) do nothing')), true);
});

test('salesMappingApplyGate no descuenta sin conteo del viernes ni sin ventas reales', () => {
  assert.equal(salesMappingApplyGate({ workbook: null, realOrders: 12, apply: true }).code, 'missing_friday_count');
  assert.equal(salesMappingApplyGate({ workbook: { targets: [] }, realOrders: 0, apply: true }).code, 'missing_sales');
  assert.equal(salesMappingApplyGate({ workbook: { targets: [] }, realOrders: 12, apply: true }).ok, true);
  assert.equal(salesMappingApplyGate({ workbook: null, realOrders: 0, apply: false }).ok, true);
});
