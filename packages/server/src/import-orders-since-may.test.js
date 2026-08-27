import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertOrdersDumpAllowed,
  catalogFromProducts,
  inspectOrdersDump,
  remapImportedItemHints,
  remapImportedListingsToExcel,
  restoreOrdersDump,
} from './catalog/import-orders-since-may.js';
import { planListingExcelRemap } from './catalog/historical-sku-map.js';

test('un dump de pedidos no puede traer catálogo ni inventario', () => {
  const allowed = inspectOrdersDump(`
    INSERT INTO companies (id, ruc) VALUES (3, '20607809136');
    INSERT INTO orders (id, channel_account_id, external_order_id) VALUES (9, 1, 'FAL-1');
    INSERT INTO order_items (id, order_id, sku) VALUES (1, 9, 'AG174');
    INSERT INTO order_events (id, order_id) VALUES (1, 9);
    INSERT INTO product_listings (id, product_id, seller_sku) VALUES (8, 99, 'AG174');
  `);
  assert.equal(allowed.hasOrders, true);
  assert.equal(allowed.hasCompanies, true);
  assert.equal(allowed.hasListings, true);
  assert.equal(allowed.hasEvents, true);
  assert.deepEqual(allowed.forbidden, []);
  assertOrdersDumpAllowed(allowed);

  const blocked = inspectOrdersDump(`
    INSERT INTO orders (id) VALUES (1);
    INSERT INTO order_items (id) VALUES (1);
    INSERT INTO products (id, main_sku) VALUES (1, 'Z7');
    INSERT INTO product_inventory (product_id, quantity_on_hand) VALUES (1, 10);
  `);
  assert.deepEqual(blocked.forbidden, ['products', 'product_inventory']);
  assert.throws(
    () => assertOrdersDumpAllowed(blocked),
    /catálogo ni inventario/,
  );
});

test('restaurar el dump trunca pedidos y no toca el inventario', () => {
  const commands = [];
  const inspection = restoreOrdersDump({
    sqlPath: '/tmp/orders-since-may.sql',
    databaseUrl: 'postgresql://zento:zento@127.0.0.1:5432/zentofact',
    inspectText: `
      INSERT INTO companies (id, ruc) VALUES (3, '20607809136');
      INSERT INTO orders (id) VALUES (9);
      INSERT INTO order_items (id, order_id) VALUES (1, 9);
    `,
    execFile(bin, args) {
      commands.push({ bin, args });
    },
  });
  assert.equal(inspection.hasCompanies, true);
  assert.equal(commands[0].bin, 'psql');
  assert.equal(commands.some((entry) => String(entry.args.at(-1)).includes('companies')), true);
  assert.equal(commands.some((entry) => String(entry.args.at(-1)).includes('product_listings')), true);
  assert.deepEqual(commands.at(-1).args.slice(-2), ['-f', '/tmp/orders-since-may.sql']);
  assert.equal(commands.some((entry) => String(entry.args.join(' ')).includes('product_inventory')), false);
});

test('un listing legado apunta al id numérico del maestro del Excel', () => {
  const catalog = catalogFromProducts([
    { id: 42, main_sku: 'Z7' },
    { id: 7, main_sku: 'G18' },
  ]);
  assert.deepEqual(planListingExcelRemap({
    id: 8, product_id: 99, seller_sku: 'AG174', shop_sku: 'FLO4400237',
  }, catalog), { listingId: 8, productId: 42, mainSku: 'Z7' });
  assert.deepEqual(planListingExcelRemap({
    id: 9, product_id: 1, seller_sku: 'G-19', shop_sku: 'x',
  }, catalog), { listingId: 9, productId: 7, mainSku: 'G18' });
  assert.equal(planListingExcelRemap({
    id: 10, product_id: 42, seller_sku: 'Z7', shop_sku: 'Z7',
  }, catalog), null);
  assert.equal(planListingExcelRemap({
    id: 11, product_id: 1, seller_sku: 'NO-EXISTE', shop_sku: '000',
  }, catalog, { trustProductId: false }), null);
});

test('remapear listings y líneas conserva el maestro operativo y no confía en product_id foráneo', async () => {
  const updates = [];
  const listingDb = {
    async query(sql, params = []) {
      if (String(sql).includes('from products')) {
        return { rows: [{ id: 42, main_sku: 'Z7' }] };
      }
      if (String(sql).includes('from product_listings')) {
        return { rows: [{ id: 8, product_id: 99, seller_sku: 'AG174', shop_sku: 'FLO4400237' }] };
      }
      updates.push(params);
      return { rowCount: 1 };
    },
  };
  assert.equal(await remapImportedListingsToExcel(listingDb), 1);
  assert.deepEqual(updates[0], [8, 42]);

  const itemQueries = [];
  const itemDb = {
    async query(sql, params = []) {
      itemQueries.push({ sql: String(sql), params });
      const text = String(sql);
      if (text.includes('from products')) return { rows: [{ id: 42, main_sku: 'Z7' }] };
      if (text.includes('from order_items oi')) {
        return { rows: [{ id: 17, sku: 'AG174', provider_sku: 'FLO4400237', main_sku: 'AG174' }] };
      }
      return { rowCount: 1 };
    },
  };
  assert.equal(await remapImportedItemHints(itemDb), 1);
  const update = itemQueries.find((entry) => entry.sql.includes('update order_items'));
  assert.equal(update.params[0], 17);
  assert.equal(update.params[1], 'Z7');

  const unlinkedDb = {
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes('from products')) return { rows: [{ id: 42, main_sku: 'Z7' }] };
      if (text.includes('from order_items oi')) {
        return { rows: [{
          id: 18, sku: 'MOC-105045', provider_sku: 'MOC-105045', main_sku: 'Z7', listing_status: 'unlinked',
        }] };
      }
      if (text.includes('update order_items')) {
        assert.equal(params[1], null);
        return { rowCount: 1 };
      }
      return { rowCount: 1 };
    },
  };
  assert.equal(await remapImportedItemHints(unlinkedDb), 1);
});
