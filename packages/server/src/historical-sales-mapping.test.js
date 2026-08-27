import assert from 'node:assert/strict';
import test from 'node:test';
import { HISTORICAL_SKU_TO_MASTER } from './catalog/historical-sku-map.js';
import {
  applyHistoricalSalesMappings,
  buildHistoricalSalesCoverage,
  classifyCountPresence,
  formatReviewTsv,
  ledgerPolicyForPresence,
  planSaleLedgerAction,
  planWarehouseExit,
  resolveSaleItem,
  buildListingIndexes,
  PHYSICAL_COUNT_CUTOFF,
} from './catalog/historical-sales-mapping.js';

function context(products, listings, extras = {}) {
  return {
    productsById: new Map(products.map((product) => [Number(product.id), product])),
    productsBySku: new Map(products.map((product) => [product.main_sku, product])),
    listingsById: new Map(listings.map((listing) => [Number(listing.id), listing])),
    listings,
    indexes: buildListingIndexes(listings),
    historicalMap: HISTORICAL_SKU_TO_MASTER,
    countCatalog: {
      countedSkus: extras.countedSkus || new Set(['H9XLN', 'Z7']),
      skusWithoutQuantity: extras.skusWithoutQuantity || new Set(['G40XL']),
    },
  };
}

const products = [
  { id: 10, main_sku: 'Z7', name: 'Z7' },
  { id: 116, main_sku: 'H9XLN', name: 'H9XLN' },
  { id: 200, main_sku: 'G40XL', name: 'G40XL' },
  { id: 270, main_sku: 'FAL-146325783', name: 'Chaleco' },
];

const listings = [
  {
    id: 20, product_id: 10, channel_code: 'falabella', company_id: 3,
    seller_sku: 'seller-z7', shop_sku: 'shop-z7', status: 'active',
  },
  {
    id: 21, product_id: 200, channel_code: 'ripley', company_id: 4,
    seller_sku: 'RIP-G40XL', shop_sku: 'P-G40XL', status: 'active',
  },
  {
    id: 22, product_id: 10, channel_code: 'falabella', company_id: 3,
    seller_sku: 'inactive-z7', shop_sku: 'inactive-shop', status: 'inactive',
  },
];

test('un listing activo exacto o un SKU interno coincidente resuelven el maestro', () => {
  const ctx = context(products, listings);
  const listed = resolveSaleItem({
    channel_code: 'falabella', company_id: 3, sku: 'seller-z7', provider_sku: 'shop-z7',
  }, ctx);
  assert.equal(listed.status, 'mapped');
  assert.equal(listed.method, 'active_seller_sku');
  assert.equal(listed.product.main_sku, 'Z7');
  assert.equal(listed.ledgerPolicy, 'deduct_after_cutoff');

  const ripley = resolveSaleItem({
    channel_code: 'ripley', company_id: 4, sku: 'RIP-G40XL', provider_sku: 'P-G40XL',
  }, ctx);
  assert.equal(ripley.status, 'mapped');
  assert.equal(ripley.countPresence, 'excel_without_quantity');
  assert.equal(ripley.ledgerPolicy, 'review_no_deduct');

  const byMainSku = resolveSaleItem({
    channel_code: 'falabella', company_id: 9, sku: 'H9XLN', provider_sku: '999',
  }, ctx);
  assert.equal(byMainSku.status, 'mapped');
  assert.equal(byMainSku.method, 'exact_main_sku');
  assert.equal(byMainSku.ledgerPolicy, 'deduct_after_cutoff');
});

test('un mapeo histórico explícito no descuenta si el maestro no está en el Excel', () => {
  const ctx = context(products, listings);
  const resolved = resolveSaleItem({
    channel_code: 'falabella', company_id: 3, sku: '357258624678', provider_sku: '146325783',
  }, ctx);
  assert.equal(resolved.status, 'mapped');
  assert.equal(resolved.method, 'explicit_historical_sku');
  assert.equal(resolved.product.main_sku, 'FAL-146325783');
  assert.equal(resolved.countPresence, 'absent_from_excel');
  assert.equal(resolved.ledgerPolicy, 'map_only_no_deduct');
});

test('un listing inactivo todavía asocia la venta al maestro', () => {
  const resolved = resolveSaleItem({
    channel_code: 'falabella', company_id: 3, sku: 'inactive-z7', provider_sku: 'x',
  }, context(products, listings));
  assert.equal(resolved.status, 'mapped');
  assert.equal(resolved.method, 'existing_listing');
  assert.equal(resolved.product.id, 10);
});

test('un shop_sku activo ambiguo o un conflicto de maestros queda para revisión', () => {
  const ambiguous = [
    ...listings,
    {
      id: 30, product_id: 116, channel_code: 'falabella', company_id: 3,
      seller_sku: 'other', shop_sku: 'shop-z7', status: 'active',
    },
  ];
  const shop = resolveSaleItem({
    channel_code: 'falabella', company_id: 3, sku: 'unknown', provider_sku: 'shop-z7',
  }, context(products, ambiguous));
  assert.equal(shop.status, 'doubtful');
  assert.match(shop.reason, /shop_sku activo ambiguo/);

  const conflict = resolveSaleItem({
    channel_code: 'falabella', company_id: 3, sku: 'seller-z7', provider_sku: '140746934',
  }, context(products, listings));
  assert.equal(conflict.status, 'doubtful');
  assert.match(conflict.reason, /varios maestros/);
});

test('un mapeo histórico sin maestro no descuenta y pide revisión', () => {
  const resolved = resolveSaleItem({
    channel_code: 'falabella', company_id: 1, sku: '23123asdfef', provider_sku: '144958533',
  }, context(products, listings));
  assert.equal(resolved.status, 'missing_master');
  assert.equal(resolved.mainSku, 'FAL-144958533');
});

test('un SKU legado o alias del Excel resuelve al código del conteo', () => {
  const ctx = context([
    ...products,
    { id: 301, main_sku: 'G35V', name: 'G35V' },
    { id: 18, main_sku: 'G18', name: 'G18' },
  ], listings, { countedSkus: new Set(['Z7', 'G35V', 'G18']), skusWithoutQuantity: new Set() });
  assert.equal(resolveSaleItem({
    channel_code: 'falabella', company_id: 1, sku: 'AG174', provider_sku: 'x',
  }, ctx).product.main_sku, 'Z7');
  assert.equal(resolveSaleItem({
    channel_code: 'falabella', company_id: 1, sku: 'AG301', provider_sku: 'x',
  }, ctx).product.main_sku, 'G35V');
  assert.equal(resolveSaleItem({
    channel_code: 'falabella', company_id: 1, sku: 'G-19', provider_sku: 'x',
  }, ctx).product.main_sku, 'G18');
});

test('una identidad sin evidencia queda unmapped', () => {
  const resolved = resolveSaleItem({
    channel_code: 'falabella', company_id: 1, sku: 'NO-EXISTE', provider_sku: '000',
  }, context(products, listings));
  assert.equal(resolved.status, 'unmapped');
});

test('el conteo físico decide si se puede descontar después del viernes', () => {
  assert.equal(classifyCountPresence('Z7', { countedSkus: new Set(['Z7']), skusWithoutQuantity: new Set() }), 'excel_counted');
  assert.equal(ledgerPolicyForPresence('excel_counted'), 'deduct_after_cutoff');
  assert.equal(ledgerPolicyForPresence('absent_from_excel'), 'map_only_no_deduct');
  assert.equal(ledgerPolicyForPresence('excel_without_quantity'), 'review_no_deduct');
});

test('solo descuenta salidas posteriores al conteo en maestros contados', () => {
  const mapped = {
    status: 'mapped', quantity: 2, productId: 10, ledgerPolicy: 'deduct_after_cutoff',
  };
  assert.equal(planSaleLedgerAction(mapped, {
    physicallyOut: true, afterCutoff: true, effectiveAt: '2026-08-22T16:00:00.000Z',
  }).action, 'deduct');
  assert.equal(planSaleLedgerAction(mapped, {
    physicallyOut: true, afterCutoff: false, effectiveAt: '2026-08-10T16:00:00.000Z',
  }).action, 'skip_before_cutoff');
  assert.equal(planSaleLedgerAction({
    ...mapped, ledgerPolicy: 'map_only_no_deduct',
  }, {
    physicallyOut: true, afterCutoff: true, effectiveAt: '2026-08-22T16:00:00.000Z',
  }).action, 'skip_not_counted');
  assert.equal(planSaleLedgerAction(mapped, {
    physicallyOut: true, afterCutoff: true, effectiveAt: '2026-08-22T16:00:00.000Z',
  }, { hasMovement: true }).action, 'already_deducted');
});

test('una salida con evento posterior al conteo entra al ledger; una anterior no', () => {
  const after = planWarehouseExit({
    quantity: 1, fulfillment_status: 'pending', ordered_at: '2026-08-20T12:00:00.000Z',
  }, [{
    id: 1, provider_occurred_at: '2026-08-22T16:00:00.000Z',
    new_values: { fulfillmentStatus: 'ready_to_ship', orderStatus: 'confirmed' },
  }], PHYSICAL_COUNT_CUTOFF);
  assert.equal(after.afterCutoff, true);
  assert.equal(after.source, 'order_event');

  const before = planWarehouseExit({
    quantity: 1, fulfillment_status: 'shipped', ordered_at: '2026-08-10T12:00:00.000Z',
  }, [], PHYSICAL_COUNT_CUTOFF);
  assert.equal(before.afterCutoff, false);
  assert.equal(before.source, 'fulfillment_ordered_at');
});

test('la cobertura descuenta solo el maestro contado con salida posterior', () => {
  const coverage = buildHistoricalSalesCoverage({
    products: [{ id: 10, main_sku: 'Z7', quantity_on_hand: 10 }, { id: 270, main_sku: 'FAL-146325783', quantity_on_hand: 0 }],
    listings,
    countedSkus: new Set(['Z7']),
    skusWithoutQuantity: new Set(),
    items: [
      {
        id: 9, order_id: 90, channel_code: 'falabella', company_id: 3, channel_account_id: 5,
        sku: 'seller-z7', provider_sku: 'shop-z7', description: 'Z7', quantity: 2,
        product_id: 10, listing_id: 20, main_sku: 'Z7', stock_applied_quantity: 0,
        ordered_at: '2026-08-22T16:00:00.000Z', fulfillment_status: 'shipped', order_status: 'confirmed',
        external_order_number: 'POST',
      },
      {
        id: 10, order_id: 91, channel_code: 'falabella', company_id: 3, channel_account_id: 5,
        sku: '357258624678', provider_sku: '146325783', description: 'Chaleco', quantity: 1,
        product_id: 270, listing_id: null, main_sku: 'FAL-146325783', stock_applied_quantity: 0,
        ordered_at: '2026-08-22T16:00:00.000Z', fulfillment_status: 'shipped', order_status: 'confirmed',
        external_order_number: 'ABSENT',
      },
    ],
  });
  assert.deepEqual(coverage.toDeduct.map((line) => line.itemId), [9]);
  assert.equal(coverage.lines.find((line) => line.itemId === 10).ledgerAction, 'skip_not_counted');
  assert.equal(coverage.summary.to_deduct, 1);
});

test('la cobertura agrupa identidades y no propone escritura cuando ya está mapeado', () => {
  const coverage = buildHistoricalSalesCoverage({
    products,
    listings,
    countedSkus: new Set(['Z7']),
    skusWithoutQuantity: new Set(['G40XL']),
    items: [
      {
        id: 1, order_id: 10, channel_code: 'falabella', company_id: 3, channel_account_id: 5,
        sku: 'seller-z7', provider_sku: 'shop-z7', description: 'Z7', quantity: 2,
        product_id: 10, listing_id: 20, main_sku: 'Z7',
        ordered_at: '2026-05-10T12:00:00.000Z', external_order_number: 'A',
      },
      {
        id: 2, order_id: 11, channel_code: 'falabella', company_id: 3, channel_account_id: 5,
        sku: 'NO-EXISTE', provider_sku: '000', description: 'Desconocido', quantity: 1,
        product_id: null, listing_id: null, main_sku: null,
        ordered_at: '2026-08-22T12:00:00.000Z', external_order_number: 'B',
      },
      {
        id: 3, order_id: 12, channel_code: 'ripley', company_id: 4, channel_account_id: 8,
        sku: 'RIP-G40XL', provider_sku: 'P-G40XL', description: 'G40XL', quantity: 1,
        product_id: null, listing_id: null, main_sku: null,
        ordered_at: '2026-08-22T15:00:00.000Z', external_order_number: 'C',
      },
    ],
  });
  assert.equal(coverage.summary.lines, 3);
  assert.equal(coverage.summary.mapped, 2);
  assert.equal(coverage.summary.unmapped, 1);
  assert.equal(coverage.summary.already_mapped, 1);
  assert.equal(coverage.summary.to_apply, 1);
  assert.equal(coverage.toApply[0].itemId, 3);
  assert.equal(coverage.toApply[0].ledgerPolicy, 'review_no_deduct');
  assert.equal(coverage.summary.to_deduct, 0);
  assert.equal(coverage.review.length, 1);
  assert.equal(coverage.review[0].seller_sku, 'NO-EXISTE');
  const tsv = formatReviewTsv(coverage.identities);
  assert.match(tsv, /NO-EXISTE/);
  assert.doesNotMatch(tsv, /seller-z7/);
});

test('aplicar el mapeo escribe product_id y no toca el inventario', async () => {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      queries.push({ sql: String(sql), params });
      if (String(sql).includes('from order_events')) return { rows: [] };
      if (String(sql).includes('distinct order_item_id')) return { rows: [] };
      if (String(sql).includes('from product_inventory')) {
        return { rows: [{ product_id: 10, quantity_on_hand: 4, quantity_reserved: 0 }] };
      }
      if (String(sql).includes('from inventory_movements')) {
        return { rows: [{ count: 7, max_id: 99 }] };
      }
      if (String(sql).includes('from products p')) {
        return { rows: products };
      }
      if (String(sql).includes('from product_listings')) {
        return { rows: listings };
      }
      if (String(sql).includes('from order_items oi')) {
        return { rows: [{
          id: 3, order_id: 12, sku: 'RIP-G40XL', provider_sku: 'P-G40XL', description: 'G40XL',
          quantity: 1, product_id: null, listing_id: null, main_sku: null, stock_state: 'none',
          stock_applied_quantity: 0, company_id: 4, channel_account_id: 8,
          external_order_number: 'C', ordered_at: '2026-08-22T15:00:00.000Z',
          order_status: 'shipped', fulfillment_status: 'shipped', channel_code: 'ripley',
        }] };
      }
      if (String(sql).startsWith('update order_items')) {
        assert.equal(params[0], 200);
        assert.equal(params[2], 'G40XL');
        assert.equal(params[3], 3);
        return { rowCount: 1 };
      }
      return { rows: [] };
    },
    release() {},
  };
  const result = await applyHistoricalSalesMappings({ async connect() { return client; } }, {
    countedSkus: new Set(['Z7']),
    skusWithoutQuantity: new Set(['G40XL']),
  });
  assert.equal(result.updatedItems, 1);
  assert.equal(result.deductedItems, 0);
  assert.equal(result.inventoryUnchanged, true);
  assert.equal(queries.some((entry) => entry.sql.includes('insert into inventory_movements')), false);
  assert.equal(queries.some((entry) => entry.sql.includes('commit')), true);
});
