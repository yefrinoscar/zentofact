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
      queries.push({ sql: String(sql), params });
      return { rows: [], rowCount: 0 };
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
  assert.equal(queries[0].params[2][0], '20607809136');
});
