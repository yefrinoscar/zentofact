import assert from 'node:assert/strict';
import test from 'node:test';
import { INVENTORY_COUNT_MASTER_SKUS } from '../../../scripts/lib/inventory-count-2026-08-21.mjs';
import {
  assertBundleWorkbook,
  coerceFulfillmentStatus,
  coerceOrderStatus,
  ingestSalesMappingBundle,
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
  assert.equal(queries.some((entry) => entry.sql.includes('product_inventory')), false);
});

test('parseSalesMappingBundle rechaza otra versión', () => {
  assert.throws(() => parseSalesMappingBundle({ version: 2 }), /version 1/);
  assert.throws(() => parseSalesMappingBundle({ version: 1, error: 'missing_friday_anchor' }), /missing_friday_anchor/);
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
});
