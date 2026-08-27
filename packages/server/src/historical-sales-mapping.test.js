import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INVENTORY_COUNT_MASTER_SKUS,
  INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY,
} from '../../../scripts/lib/inventory-count-2026-08-21.mjs';
import {
  EXCEL_ROW_ALIAS_TO_MASTER,
  HISTORICAL_SKU_TO_MASTER,
  LEGACY_AG_TO_EXCEL,
  RIPLEY_SKU_TO_MASTER,
  excelMasterForSku,
  historicalMasterForSku,
  historicalMastersAbsentFromExcel,
} from './catalog/historical-sku-map.js';
import {
  applyHistoricalSalesMappings,
  buildEmptyUnifiedOrderGapIdentities,
  buildFalabellaInboxGapIdentities,
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

test('un maestro histórico ausente del Excel se asocia y no se descuenta', () => {
  const ctx = context([
    ...products,
    { id: 227, main_sku: 'AG227', name: 'AG227' },
  ], listings);
  const resolved = resolveSaleItem({
    channel_code: 'falabella', company_id: 1, sku: 'TRI65748392', provider_sku: 'TRI65748392',
  }, ctx);
  assert.equal(resolved.status, 'mapped');
  assert.equal(resolved.product.main_sku, 'AG227');
  assert.equal(resolved.countPresence, 'absent_from_excel');
  assert.equal(resolved.ledgerPolicy, 'map_only_no_deduct');
});

test('los maestros históricos que no están en el Excel quedan fuera del conteo', () => {
  const catalog = new Set([...INVENTORY_COUNT_MASTER_SKUS, ...INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY]);
  const absent = historicalMastersAbsentFromExcel(catalog);
  assert.equal(absent.includes('Z7'), false);
  assert.equal(absent.includes('H36'), false);
  assert.equal(absent.includes('AG107'), false);
  assert.equal(absent.includes('G1RAMAS'), false);
  assert.ok(absent.includes('AG227'));
  assert.ok(absent.includes('FAL-144958533'));
  assert.ok(absent.includes('FAL-144962663'));
  assert.ok(absent.includes('AM7'));
  assert.ok(absent.includes('AG289'));
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

test('una publicación desvinculada no usa el maestro anterior ni el main_sku residual', () => {
  const unlinkedListings = [
    ...listings,
    {
      id: 40, product_id: 10, channel_code: 'ripley', company_id: 1,
      seller_sku: 'MOC-105045', shop_sku: 'MOC-105045', status: 'unlinked',
    },
  ];
  const leftoverProduct = resolveSaleItem({
    channel_code: 'ripley', company_id: 1, sku: 'MOC-105045', provider_sku: 'MOC-105045',
    product_id: 10, main_sku: 'Z7',
  }, context(products, unlinkedListings));
  assert.equal(leftoverProduct.status, 'doubtful');
  assert.match(leftoverProduct.reason, /desvinculada/);

  const leftoverHint = resolveSaleItem({
    channel_code: 'ripley', company_id: 1, sku: 'MOC-105045', provider_sku: 'MOC-105045',
    main_sku: 'Z7',
  }, context(products, unlinkedListings));
  assert.equal(leftoverHint.status, 'doubtful');

  const historicalUnlinked = resolveSaleItem({
    channel_code: 'falabella', company_id: 4, sku: '140746934', provider_sku: '156576540',
  }, context(products, [
    ...listings,
    {
      id: 41, product_id: 116, channel_code: 'falabella', company_id: 4,
      seller_sku: '140746934', shop_sku: '156576540', status: 'unlinked',
    },
  ]));
  assert.equal(historicalUnlinked.status, 'doubtful');
  assert.match(historicalUnlinked.reason, /desvinculada/);

  const stillMapped = resolveSaleItem({
    channel_code: 'falabella', company_id: 9, sku: 'FAL-RANDOM', provider_sku: '999',
    main_sku: 'Z7',
  }, context(products, unlinkedListings));
  assert.equal(stillMapped.status, 'mapped');
  assert.equal(stillMapped.product.main_sku, 'Z7');
});

test('el main_sku operativo de la línea resuelve el maestro aunque el seller SKU no mapee', () => {
  const byHint = resolveSaleItem({
    channel_code: 'falabella', company_id: 9, sku: 'FAL-RANDOM', provider_sku: '999',
    main_sku: 'Z7',
  }, context(products, listings));
  assert.equal(byHint.status, 'mapped');
  assert.equal(byHint.method, 'exact_main_sku');
  assert.equal(byHint.product.main_sku, 'Z7');
  assert.equal(byHint.ledgerPolicy, 'deduct_after_cutoff');

  const byLegacyHint = resolveSaleItem({
    channel_code: 'falabella', company_id: 9, sku: 'FAL-RANDOM', provider_sku: '999',
    main_sku: 'AG174',
  }, context(products, listings));
  assert.equal(byLegacyHint.status, 'mapped');
  assert.equal(byLegacyHint.product.main_sku, 'Z7');
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

test('una cantidad 0 sin Quantity en el payload cuenta como 1 unidad y se descuenta', () => {
  const coverage = buildHistoricalSalesCoverage({
    products: [{ id: 10, main_sku: 'Z7', quantity_on_hand: 10 }],
    listings,
    countedSkus: new Set(['Z7']),
    skusWithoutQuantity: new Set(),
    items: [
      {
        id: 11, order_id: 92, channel_code: 'falabella', company_id: 3, channel_account_id: 5,
        sku: 'seller-z7', provider_sku: 'shop-z7', description: 'Z7', quantity: 0,
        product_id: 10, listing_id: 20, main_sku: 'Z7', stock_applied_quantity: 0,
        ordered_at: '2026-08-22T16:00:00.000Z', fulfillment_status: 'shipped', order_status: 'confirmed',
        external_order_number: 'ZERO',
      },
      {
        id: 12, order_id: 93, channel_code: 'falabella', company_id: 3, channel_account_id: 5,
        sku: 'seller-z7', provider_sku: 'shop-z7', description: 'Z7', quantity: 0, raw_data: { Quantity: 0 },
        product_id: 10, listing_id: 20, main_sku: 'Z7', stock_applied_quantity: 0,
        ordered_at: '2026-08-22T16:00:00.000Z', fulfillment_status: 'shipped', order_status: 'confirmed',
        external_order_number: 'EXPLICIT-ZERO',
      },
    ],
  });
  const omitted = coverage.lines.find((line) => line.itemId === 11);
  assert.equal(omitted.quantity, 1);
  assert.equal(omitted.ledgerAction, 'deduct');
  const explicit = coverage.lines.find((line) => line.itemId === 12);
  assert.equal(explicit.quantity, 0);
  assert.equal(explicit.ledgerAction, 'skip_not_exited');
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
  assert.equal(coverage.review.length, 2);
  assert.equal(coverage.review.some((row) => row.seller_sku === 'NO-EXISTE'), true);
  assert.equal(coverage.review.some((row) => row.seller_sku === 'RIP-G40XL'), true);
  const tsv = formatReviewTsv(coverage.identities);
  assert.match(tsv, /NO-EXISTE/);
  assert.match(tsv, /RIP-G40XL/);
  assert.doesNotMatch(tsv, /seller-z7/);
});

test('un pedido Falabella del inbox sin líneas o con líneas no unificadas queda en revisión', () => {
  const empty = buildFalabellaInboxGapIdentities([{
    company_id: 9,
    order_id: 'PV-EMPTY',
    order_number: '1',
    falabella_created_at: '2026-08-22T16:00:00.000Z',
    raw_data: { Statuses: 'pending' },
  }], { orders: new Set(), items: new Set() });
  assert.equal(empty.length, 1);
  assert.equal(empty[0].status, 'unmapped');
  assert.match(empty[0].reason, /no trae líneas/);

  const leftover = buildFalabellaInboxGapIdentities([{
    company_id: 9,
    order_id: 'PV-PARTIAL',
    order_number: '2',
    raw_data: {
      OrderItems: {
        OrderItem: [
          { OrderItemId: '7', SellerSku: 'AG174', ShopSku: 'FLO4400237', Quantity: '1' },
          { OrderItemId: '8', SellerSku: 'Z7', ShopSku: 'FLO4400237', Quantity: '1' },
        ],
      },
    },
  }], {
    orders: new Set(['9\u0000PV-PARTIAL']),
    items: new Set(['9\u0000PV-PARTIAL\u00007']),
  });
  assert.deepEqual(leftover.map((row) => row.seller_sku), ['Z7']);
  assert.match(leftover[0].reason, /ausente del pedido unificado/);

  const covered = buildHistoricalSalesCoverage({
    items: [{
      id: 1, order_id: 1, external_item_id: '7', sku: 'AG174', provider_sku: 'FLO4400237',
      quantity: 1, company_id: 9, external_order_id: 'PV-PARTIAL',
      ordered_at: '2026-08-22T16:00:00.000Z', fulfillment_status: 'shipped',
      channel_code: 'falabella',
    }],
    products,
    listings,
    countedSkus: new Set(['Z7']),
    skusWithoutQuantity: new Set(),
    falabellaInbox: [{
      company_id: 9,
      order_id: 'PV-PARTIAL',
      raw_data: {
        OrderItems: { OrderItem: { OrderItemId: '7', SellerSku: 'AG174', ShopSku: 'FLO4400237', Quantity: '1' } },
      },
    }],
  });
  assert.equal(covered.summary.inbox_gaps, 0);
});

test('un pedido unificado Falabella o Ripley sin líneas queda en revisión', () => {
  const gaps = buildEmptyUnifiedOrderGapIdentities([
    {
      company_id: 4,
      channel_code: 'ripley',
      external_order_id: 'RIP-EMPTY',
      external_order_number: '88',
      ordered_at: '2026-06-02T12:00:00.000Z',
    },
  ]);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].channel, 'ripley');
  assert.match(gaps[0].reason, /no trae líneas/);

  const coverage = buildHistoricalSalesCoverage({
    items: [],
    products,
    listings,
    countedSkus: new Set(['Z7']),
    skusWithoutQuantity: new Set(),
    falabellaInbox: [{
      company_id: 9,
      order_id: 'PV-EMPTY',
      order_number: '1',
      raw_data: {},
    }],
    emptyOrders: [{
      company_id: 9,
      channel_code: 'falabella',
      external_order_id: 'PV-EMPTY',
      external_order_number: '1',
      ordered_at: '2026-08-22T16:00:00.000Z',
    }],
  });
  assert.equal(coverage.summary.inbox_gaps, 0);
  assert.equal(coverage.summary.header_gaps, 1);
  assert.equal(coverage.review.length, 1);
  assert.match(coverage.review[0].reason, /pedido unificado/);
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

test('cada AG legado y alias del Excel apunta a un ID del conteo', () => {
  for (const [legacy, master] of Object.entries(LEGACY_AG_TO_EXCEL)) {
    assert.ok(
      INVENTORY_COUNT_MASTER_SKUS.has(master) || INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY.has(master),
      `${legacy} → ${master} no está en el Excel`,
    );
  }
  for (const [alias, master] of Object.entries(EXCEL_ROW_ALIAS_TO_MASTER)) {
    assert.equal(INVENTORY_COUNT_MASTER_SKUS.has(master), true, `${alias} → ${master}`);
  }
});

test('cada ID del Excel es el maestro cuando existe el producto', () => {
  const excelIds = [...INVENTORY_COUNT_MASTER_SKUS, ...INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY];
  const excelProducts = excelIds.map((sku, index) => ({ id: index + 1, main_sku: sku, name: sku }));
  const ctx = context(excelProducts, [], {
    countedSkus: INVENTORY_COUNT_MASTER_SKUS,
    skusWithoutQuantity: INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY,
  });
  for (const sku of INVENTORY_COUNT_MASTER_SKUS) {
    const resolved = resolveSaleItem({
      channel_code: 'falabella', company_id: 1, sku, provider_sku: sku,
    }, ctx);
    assert.equal(resolved.status, 'mapped', sku);
    assert.equal(resolved.product.main_sku, sku);
    assert.equal(resolved.method, 'exact_main_sku');
    assert.equal(resolved.ledgerPolicy, 'deduct_after_cutoff');
  }
  for (const sku of INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY) {
    const resolved = resolveSaleItem({
      channel_code: 'falabella', company_id: 1, sku, provider_sku: sku,
    }, ctx);
    assert.equal(resolved.status, 'mapped', sku);
    assert.equal(resolved.product.main_sku, sku);
    assert.equal(resolved.ledgerPolicy, 'review_no_deduct');
  }
  for (const [legacy, master] of Object.entries(LEGACY_AG_TO_EXCEL)) {
    const resolved = resolveSaleItem({
      channel_code: 'falabella', company_id: 1, sku: legacy, provider_sku: 'x',
    }, ctx);
    assert.equal(resolved.status, 'mapped', `${legacy} → ${master}`);
    assert.equal(resolved.product.main_sku, master);
    assert.equal(resolved.method, 'explicit_historical_sku');
  }
  const alias = resolveSaleItem({
    channel_code: 'falabella', company_id: 1, sku: 'G-19', provider_sku: 'x',
  }, ctx);
  assert.equal(alias.product.main_sku, 'G18');
  const marketplace = resolveSaleItem({
    channel_code: 'falabella', company_id: 1, sku: 'FLO4400237', provider_sku: 'x',
  }, ctx);
  assert.equal(marketplace.product.main_sku, 'Z7');
  assert.equal(HISTORICAL_SKU_TO_MASTER.AG174, 'Z7');
});

test('un SKU legado o el código del Excel resuelven al maestro del conteo', () => {
  const catalog = new Set([...INVENTORY_COUNT_MASTER_SKUS, ...INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY]);
  assert.equal(excelMasterForSku('Z7', catalog), 'Z7');
  assert.equal(excelMasterForSku('AG174', catalog), 'Z7');
  assert.equal(excelMasterForSku('G-19', catalog), 'G18');
  assert.equal(excelMasterForSku('G40XL', catalog), 'G40XL');
  assert.equal(excelMasterForSku('NO-EXISTE', catalog), null);
  assert.equal(excelMasterForSku('TRI65748392', catalog), null);
  assert.equal(excelMasterForSku('TRI65748392', new Set([...catalog, 'AG227'])), 'AG227');
  assert.equal(excelMasterForSku('S119266', catalog), 'G1RAMAS');
  assert.equal(excelMasterForSku('SET-777810', catalog), 'Z7');
  assert.equal(excelMasterForSku('GUA-104022', catalog), 'H13M');
  assert.equal(excelMasterForSku('TRI-100358', catalog), null);
  assert.equal(excelMasterForSku('TRI-100358', new Set([...catalog, 'AG227'])), 'AG227');
  assert.equal(historicalMasterForSku('S119266'), 'G1RAMAS');
  assert.equal(historicalMasterForSku('BOT-105522'), 'AM7');
  assert.equal(historicalMasterForSku('MOC-105045'), null);
});

test('un SKU Ripley documentado resuelve al maestro del Excel o queda anclado sin descontar', () => {
  const excelIds = [...INVENTORY_COUNT_MASTER_SKUS, ...INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY];
  const extraMasters = ['AG138', 'AG86', 'AM7', 'AG227', 'AG289', 'AG290', 'AG291', 'AG292', 'AG293', 'AG294', 'AG295', 'FAL-144962663'];
  const productsForRipley = [...excelIds, ...extraMasters].map((sku, index) => ({
    id: index + 1, main_sku: sku, name: sku,
  }));
  const ctx = context(productsForRipley, [], {
    countedSkus: INVENTORY_COUNT_MASTER_SKUS,
    skusWithoutQuantity: INVENTORY_COUNT_SKUS_WITHOUT_QUANTITY,
  });
  const ramitas = resolveSaleItem({
    channel_code: 'ripley', company_id: 1, sku: 'S119266', provider_sku: 'S119266',
  }, ctx);
  assert.equal(ramitas.status, 'mapped');
  assert.equal(ramitas.product.main_sku, 'G1RAMAS');
  assert.equal(ramitas.ledgerPolicy, 'deduct_after_cutoff');

  const triturador = resolveSaleItem({
    channel_code: 'ripley', company_id: 1, sku: 'TRI-100358', provider_sku: 'TRI-100358',
  }, ctx);
  assert.equal(triturador.status, 'mapped');
  assert.equal(triturador.product.main_sku, 'AG227');
  assert.equal(triturador.ledgerPolicy, 'map_only_no_deduct');

  const celeste = resolveSaleItem({
    channel_code: 'ripley', company_id: 1, sku: 'S166285', provider_sku: 'S166285',
  }, ctx);
  assert.equal(celeste.status, 'mapped');
  assert.equal(celeste.product.main_sku, 'G35V');
  assert.equal(celeste.ledgerPolicy, 'deduct_after_cutoff');

  const falabellaCeleste = resolveSaleItem({
    channel_code: 'falabella', company_id: 1, sku: '143571425', provider_sku: '143571425',
  }, ctx);
  assert.equal(falabellaCeleste.status, 'mapped');
  assert.equal(falabellaCeleste.product.main_sku, 'G35V');

  const beige = resolveSaleItem({
    channel_code: 'falabella', company_id: 1, sku: 'SILLA-BEIGE', provider_sku: '156582201',
  }, ctx);
  assert.equal(beige.status, 'mapped');
  assert.equal(beige.product.main_sku, 'G34R');
  assert.equal(beige.ledgerPolicy, 'deduct_after_cutoff');

  const rosa = resolveSaleItem({
    channel_code: 'falabella', company_id: 1, sku: 'SILLA-ROSA', provider_sku: '144962663',
  }, ctx);
  assert.equal(rosa.status, 'mapped');
  assert.equal(rosa.product.main_sku, 'FAL-144962663');
  assert.equal(rosa.ledgerPolicy, 'map_only_no_deduct');

  const unlinked = resolveSaleItem({
    channel_code: 'ripley', company_id: 1, sku: 'MOC-105045', provider_sku: 'MOC-105045',
  }, ctx);
  assert.equal(unlinked.status, 'unmapped');

  for (const [sellerSku, ag] of Object.entries(RIPLEY_SKU_TO_MASTER)) {
    const terminal = historicalMasterForSku(sellerSku);
    const resolved = resolveSaleItem({
      channel_code: 'ripley', company_id: 1, sku: sellerSku, provider_sku: sellerSku,
    }, ctx);
    assert.equal(resolved.status, 'mapped', `${sellerSku} → ${ag}`);
    assert.equal(resolved.product.main_sku, terminal, `${sellerSku} → ${terminal}`);
  }
});
