import assert from 'node:assert/strict';
import test from 'node:test';
import { INVENTORY_COUNT_MASTER_SKUS } from '../../../scripts/lib/inventory-count-2026-08-21.mjs';
import {
  assertBundleWorkbook,
  coerceFulfillmentStatus,
  coerceOrderStatus,
  ingestSalesMappingBundle,
  listingMasterSku,
  parseSalesMappingBundle,
  workbookFromBundleExcel,
  workbookFromReconciliationAnchors,
} from './catalog/sales-mapping-bundle.js';

test('las anclas de conciliación del viernes rellenan IDs del Excel, incluso desde AG legado', () => {
  const workbook = assertBundleWorkbook(workbookFromReconciliationAnchors({
    run: {
      cutoff_at: '2026-08-21T19:50:00.000Z',
      source_hash: 'ac509fd821ef2887f74048a867f744030efe4a819188794fe09554d463a3d9e6',
    },
    rows: [...INVENTORY_COUNT_MASTER_SKUS].map((sku) => ({
      main_sku: sku === 'Z7' ? 'AG174' : sku,
      cutoff_quantity: sku === 'Z7' ? 1374 : 10,
    })),
  }));
  assert.equal(workbook.targets.find((target) => target.masterSku === 'Z7').targetQuantity, 1374);
  assert.equal(workbook.source, 'reconciliation_anchors');
  assert.throws(
    () => workbookFromReconciliationAnchors({
      run: { cutoff_at: '2026-08-01T05:00:00.000Z', source_hash: 'x' },
      rows: [],
    }),
    /conteo del viernes/,
  );
});

test('el bundle version 1 carga el conteo del viernes y rechaza uno incompleto', () => {
  const workbook = assertBundleWorkbook(workbookFromBundleExcel({
    sourceHash: 'abc',
    targets: [...INVENTORY_COUNT_MASTER_SKUS].map((masterSku) => ({
      masterSku, sourceRows: [1], targetQuantity: masterSku === 'Z7' ? 1374 : 10,
    })),
  }));
  assert.equal(workbook.targets.find((target) => target.masterSku === 'Z7').targetQuantity, 1374);
  assert.throws(
    () => assertBundleWorkbook(workbookFromBundleExcel({
      targets: [{ masterSku: 'Z7', targetQuantity: 1 }],
    })),
    /no tiene estos maestros/,
  );
});

test('un estado operativo desconocido se normaliza al check de orders', () => {
  assert.equal(coerceOrderStatus('PROCESSING'), 'confirmed');
  assert.equal(coerceOrderStatus('canceled'), 'cancelled');
  assert.equal(coerceFulfillmentStatus('READY TO SHIP'), 'ready_to_ship');
  assert.equal(coerceFulfillmentStatus('delivered_to_customer'), 'delivered');
});

test('ingerir el bundle crea empresa, listing Excel y línea sin product_id', async () => {
  const queries = [];
  const db = {
    async query(sql, params = []) {
      queries.push({ sql: String(sql), params });
      const text = String(sql);
      if (text.includes('delete from orders')) return { rowCount: 0 };
      if (text.includes('from products')) return { rows: [{ id: 1, main_sku: 'Z7' }] };
      if (text.includes('from companies where ruc')) return { rows: [] };
      if (text.startsWith('insert into companies')) return { rows: [{ id: 9 }] };
      if (text.includes('from order_channels')) return { rows: [{ id: 1 }] };
      if (text.includes('from order_channel_accounts')) return { rows: [{ id: 4 }] };
      if (text.startsWith('insert into product_listings')) return { rowCount: 1 };
      if (text.startsWith('insert into orders')) return { rows: [{ id: 70 }] };
      if (text.startsWith('insert into order_items')) return { rowCount: 1 };
      if (text.startsWith('insert into order_events')) return { rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
  const result = await ingestSalesMappingBundle(db, {
    version: 1,
    companies: [{ ruc: '20607809136', nombre: 'LIMBO PERU' }],
    listings: [{
      channel: 'falabella', companyRuc: '20607809136', sellerSku: 'AG174', shopSku: 'FLO4400237',
      status: 'active', title: 'Z7',
    }],
    orders: [{
      channel: 'falabella',
      companyRuc: '20607809136',
      externalOrderId: 'FAL-99',
      externalOrderNumber: '99',
      orderedAt: '2026-08-22T16:00:00.000Z',
      orderStatus: 'confirmed',
      fulfillmentStatus: 'shipped',
      items: [{ sku: 'AG174', providerSku: 'FLO4400237', quantity: 1, description: 'Z7' }],
      events: [{
        eventType: 'status',
        providerOccurredAt: '2026-08-22T17:00:00.000Z',
        newValues: { fulfillmentStatus: 'ready_to_ship' },
      }],
    }],
  });
  assert.equal(result.companies, 1);
  assert.equal(result.listings, 1);
  assert.equal(result.orders, 1);
  assert.equal(result.items, 1);
  assert.equal(result.events, 1);
  const listing = queries.find((entry) => entry.sql.startsWith('insert into product_listings'));
  assert.equal(listing.params[0], 1);
  assert.equal(listing.params[4], 'AG174');
  const item = queries.find((entry) => entry.sql.startsWith('insert into order_items'));
  assert.equal(item.params[2], 'AG174');
  assert.equal(item.params[6], 'Z7');
  assert.match(item.sql, /product_id, listing_id, main_sku/);
  assert.match(item.sql, /null,null,\$7/);
  assert.equal(queries.some((entry) => entry.sql.includes('product_inventory')), false);
});

test('ingerir un listing histórico ausente del Excel lo ancla al maestro sin inventario', async () => {
  const queries = [];
  const db = {
    async query(sql, params = []) {
      queries.push({ sql: String(sql), params });
      const text = String(sql);
      if (text.includes('delete from orders')) return { rowCount: 0 };
      if (text.includes('from products')) return { rows: [{ id: 227, main_sku: 'AG227' }] };
      if (text.includes('from companies where ruc')) return { rows: [{ id: 9 }] };
      if (text.includes('from order_channels')) return { rows: [{ id: 1 }] };
      if (text.includes('from order_channel_accounts')) return { rows: [{ id: 4 }] };
      if (text.startsWith('insert into product_listings')) return { rowCount: 1 };
      if (text.startsWith('insert into orders')) return { rows: [{ id: 71 }] };
      if (text.startsWith('insert into order_items')) return { rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
  const result = await ingestSalesMappingBundle(db, {
    version: 1,
    companies: [{ ruc: '20607809136', nombre: 'LIMBO PERU' }],
    listings: [{
      channel: 'falabella', companyRuc: '20607809136', sellerSku: 'TRI65748392', shopSku: 'TRI65748392',
      status: 'active', title: 'Triciclo',
    }],
    orders: [{
      channel: 'falabella',
      companyRuc: '20607809136',
      externalOrderId: 'FAL-TRI',
      externalOrderNumber: 'TRI',
      orderedAt: '2026-08-22T16:00:00.000Z',
      orderStatus: 'confirmed',
      fulfillmentStatus: 'shipped',
      items: [{ sku: 'TRI65748392', providerSku: 'TRI65748392', quantity: 1, description: 'Triciclo' }],
    }],
  });
  assert.equal(result.listings, 1);
  const listing = queries.find((entry) => entry.sql.startsWith('insert into product_listings'));
  assert.equal(listing.params[0], 227);
  assert.equal(listing.params[4], 'TRI65748392');
});

test('el listing usa productSku operativo y crea el maestro ausente en stock 0', async () => {
  const catalog = new Set([...INVENTORY_COUNT_MASTER_SKUS]);
  assert.equal(listingMasterSku({
    sellerSku: 'AG174', shopSku: 'FLO4400237', productSku: 'AG174',
  }, catalog), 'Z7');
  assert.equal(listingMasterSku({
    sellerSku: '140746934', shopSku: '140746934', productSku: 'H9XLN',
  }, catalog), 'H9XLN');
  assert.equal(listingMasterSku({
    sellerSku: 'FAL-RANDOM', shopSku: '999', productSku: 'AG178',
  }, catalog), 'AG178');
  assert.equal(listingMasterSku({
    sellerSku: 'S119266', shopSku: 'S119266', productSku: 'AG107',
  }, catalog), 'G1RAMAS');
  assert.equal(listingMasterSku({
    sellerSku: 'SET-777810', shopSku: 'SET-777810', productSku: '',
  }, catalog), 'Z7');

  const queries = [];
  const db = {
    async query(sql, params = []) {
      queries.push({ sql: String(sql), params });
      const text = String(sql).trim();
      if (text.startsWith('delete from orders')) return { rowCount: 0 };
      if (text.startsWith('select id, main_sku from products')) return { rows: [{ id: 1, main_sku: 'Z7' }] };
      if (text.startsWith('select id from companies')) return { rows: [{ id: 9 }] };
      if (text.startsWith('select id from order_channels')) return { rows: [{ id: 1 }] };
      if (text.startsWith('select id from order_channel_accounts')) return { rows: [{ id: 4 }] };
      if (text.startsWith('insert into products')) return { rows: [{ id: 178 }] };
      if (text.startsWith('insert into product_inventory')) return { rowCount: 1 };
      if (text.startsWith('insert into product_listings')) return { rowCount: 1 };
      if (text.startsWith('insert into orders')) return { rows: [{ id: 80 }] };
      if (text.startsWith('insert into order_items')) return { rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
  const result = await ingestSalesMappingBundle(db, {
    version: 1,
    companies: [{ ruc: '20607809136', nombre: 'LIMBO PERU' }],
    listings: [{
      channel: 'falabella', companyRuc: '20607809136',
      sellerSku: 'FAL-RANDOM', shopSku: '999', productSku: 'AG178',
      status: 'active', title: 'AG178',
    }],
    orders: [],
  });
  assert.equal(result.listings, 1);
  const created = queries.find((entry) => entry.sql.trim().startsWith('insert into products'));
  assert.equal(created.params[0], 'AG178');
  assert.equal(JSON.parse(created.params[1]).source, 'historical_master_absent_from_excel');
  const listing = queries.find((entry) => entry.sql.trim().startsWith('insert into product_listings'));
  assert.equal(listing.params[0], 178);
  assert.equal(listing.params[4], 'FAL-RANDOM');
  const inventory = queries.find((entry) => entry.sql.includes('product_inventory'));
  assert.ok(inventory);
});

test('una línea de listing desvinculado no hereda el maestro residual', async () => {
  const queries = [];
  const db = {
    async query(sql, params = []) {
      queries.push({ sql: String(sql), params });
      const text = String(sql).trim();
      if (text.startsWith('delete from orders')) return { rowCount: 0 };
      if (text.startsWith('select id, main_sku from products')) return { rows: [{ id: 1, main_sku: 'Z7' }] };
      if (text.startsWith('select id from companies')) return { rows: [{ id: 9 }] };
      if (text.startsWith('select id from order_channels')) return { rows: [{ id: 1 }] };
      if (text.startsWith('select id from order_channel_accounts')) return { rows: [{ id: 4 }] };
      if (text.startsWith('insert into product_listings')) return { rowCount: 1 };
      if (text.startsWith('insert into orders')) return { rows: [{ id: 81 }] };
      if (text.startsWith('insert into order_items')) return { rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
  await ingestSalesMappingBundle(db, {
    version: 1,
    companies: [{ ruc: '20607809136', nombre: 'LIMBO PERU' }],
    listings: [{
      channel: 'ripley', companyRuc: '20607809136',
      sellerSku: 'MOC-105045', shopSku: 'MOC-105045', productSku: 'Z7',
      status: 'unlinked', title: 'Mochila',
    }],
    orders: [{
      channel: 'ripley', companyRuc: '20607809136',
      externalOrderId: 'RIP-1', orderedAt: '2026-08-22T16:00:00.000Z',
      orderStatus: 'confirmed', fulfillmentStatus: 'shipped',
      items: [{ sku: 'MOC-105045', providerSku: 'MOC-105045', productSku: 'Z7', quantity: 1 }],
    }],
  });
  const listing = queries.find((entry) => entry.sql.trim().startsWith('insert into product_listings'));
  assert.equal(listing.params[7], 'unlinked');
  assert.match(listing.sql, /status=excluded.status/);
  const item = queries.find((entry) => entry.sql.trim().startsWith('insert into order_items'));
  assert.equal(item.params[6], null);
});

test('parseSalesMappingBundle rechaza otra versión', () => {
  assert.throws(() => parseSalesMappingBundle({ version: 2 }), /version 1/);
  assert.throws(() => parseSalesMappingBundle({ version: 1, error: 'missing_friday_anchor' }), /missing_friday_anchor/);
  assert.throws(
    () => parseSalesMappingBundle({ version: 1, error: 'incomplete_friday_count', missing: ['G34R', 'Z7'] }),
    /Faltan: G34R, Z7/,
  );
});

test('el SQL de export incluye el mapa AG→Excel y no toca inventario', async () => {
  const { readFileSync } = await import('node:fs');
  const { renderExportSalesMappingBundleSql } = await import('./catalog/export-sales-mapping-bundle-sql.js');
  const sql = renderExportSalesMappingBundleSql();
  assert.equal(
    readFileSync(new URL('../../../scripts/export-sales-mapping-bundle.sql', import.meta.url), 'utf8'),
    sql,
  );
  assert.match(sql, /'AG174', 'Z7'/);
  assert.match(sql, /'AG301', 'G35V'/);
  assert.match(sql, /'G-19', 'G18'/);
  assert.match(sql, /falabella/);
  assert.match(sql, /ripley/);
  assert.match(sql, /2026-05-01T05:00:00.000Z/);
  assert.match(sql, /2026-08-21T19:50:00.000Z/);
  assert.doesNotMatch(sql, /from product_inventory/i);
  assert.doesNotMatch(sql, /from inventory_movements/i);
  assert.doesNotMatch(sql, /insert into products/i);
  assert.match(sql, /incomplete_friday_count/);
  assert.match(sql, /jsonb_agg\(c\.master ORDER BY c\.master\)/);
  assert.match(sql, /'productSku'/);
  assert.match(sql, /LEFT JOIN products p ON p\.id = l\.product_id/);
  assert.match(sql, /LEFT JOIN products p ON p\.id = oi\.product_id/);
});

test('descubre el bundle y el Excel aunque el nombre no sea el canónico', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const {
    discoverSalesMappingInputs,
    isFridayCountWorkbookName,
    isOrdersDumpText,
    isSalesMappingBundleText,
  } = await import('./catalog/find-sales-mapping-inputs.js');
  const dir = mkdtempSync(join(tmpdir(), 'sales-map-inputs-'));
  try {
    writeFileSync(join(dir, 'reporte_empresas_julio_2026.xlsx'), 'not-excel');
    writeFileSync(join(dir, 'stock 21.08.2026 a las 2.50 pm (1).xlsx'), 'workbook');
    writeFileSync(join(dir, 'sales-mapping-bundle (1).json'), JSON.stringify({
      version: 1, cutoffAt: '2026-08-21T19:50:00.000Z', excel: { targets: [] }, orders: [],
    }));
    writeFileSync(join(dir, 'orders-since-may (1).sql'), 'INSERT INTO orders (id) VALUES (1);\n');
    writeFileSync(join(dir, 'catalog.sql'), 'INSERT INTO products (id) VALUES (1);\nINSERT INTO orders (id) VALUES (2);\n');
    assert.equal(isFridayCountWorkbookName('stock 21.08.2026 a las 2.50 pm (1).xlsx'), true);
    assert.equal(isFridayCountWorkbookName('reporte_empresas_julio_2026.xlsx'), false);
    assert.equal(isSalesMappingBundleText('{"version":1,"excel":{}}'), true);
    assert.equal(isSalesMappingBundleText('{"version":1,"error":"missing_friday_anchor"}'), false);
    assert.equal(isOrdersDumpText('INSERT INTO orders (id) VALUES (1);'), true);
    assert.equal(isOrdersDumpText('INSERT INTO products (id) VALUES (1); INSERT INTO orders (id) VALUES (2);'), false);
    const found = discoverSalesMappingInputs({ cwd: dir, directories: [dir] });
    assert.match(found.excel, /stock 21\.08\.2026 a las 2\.50 pm \(1\)\.xlsx$/);
    assert.match(found.bundle, /sales-mapping-bundle \(1\)\.json$/);
    assert.match(found.ordersSql, /orders-since-may \(1\)\.sql$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
