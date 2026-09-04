import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyInventoryMovement,
  applyInventoryReservation,
  InsufficientStockError,
  listMovements,
} from './catalog/inventory-service.js';
import { resolveListing } from './catalog/sku-resolver.js';
import { needsReturnStockApproval, RETURN_STOCK_APPROVAL_FROM_AT, stockPhase } from './catalog/stock-phase.js';
import { approveReturnStock } from './order-management.js';
import { INVENTORY_LISTEN_FROM_AT } from './catalog/stock-commitment.js';
import {
  falabellaCanonicalIdentity,
  importFalabellaCatalog,
  isFalabellaActivePublished,
  sanitizeMainSku,
} from './catalog/catalog-import.js';
import {
  falabellaPublicationSnapshot,
  falabellaPublicationState,
  fetchFalabellaPublicAvailabilities,
  fetchFalabellaProductsBySku,
  fetchFalabellaStocks,
  refreshFalabellaListingSnapshots,
  refreshRipleyListingSnapshots,
} from './catalog/listing-snapshot-service.js';
import { getCatalogSummary, listProducts, listTodayProductSales } from './catalog/product-service.js';
import { hydrateProductActivity, hydrateRecentSalesActivity, LIVE_WINDOW_DAYS } from './catalog/catalog-sales.js';
import {
  falabellaAssociationProfile,
  groupFalabellaCatalogRecords,
  scoreFalabellaAssociation,
} from './catalog/catalog-association.js';

class InventoryDb {
  constructor(quantity = 10) {
    this.quantity = quantity;
    this.reserved = 0;
    this.pendingReturn = 0;
    this.approvals = new Map();
    this.movements = new Map();
    this.items = new Map();
    this.listings = [];
    this.queries = [];
    this.nextMovementId = 1;
  }

  async query(sql, params = []) {
    const compact = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    this.queries.push({ sql: compact, params });
    if (compact.startsWith('insert into product_inventory')) return { rows: [] };
    if (compact.startsWith('select quantity_on_hand, quantity_reserved')) {
      return { rows: [{
        quantity_on_hand: this.quantity,
        quantity_reserved: this.reserved,
        quantity_pending_return: this.pendingReturn,
      }] };
    }
    if (compact.startsWith('select * from inventory_movements where idempotency_key')) {
      const row = this.movements.get(params[0]);
      return { rows: row ? [row] : [] };
    }
    if (compact.startsWith('insert into inventory_movements')) {
      const key = params[10];
      if (this.movements.has(key)) return { rows: [] };
      const row = {
        id: this.nextMovementId++, product_id: params[0], movement_type: params[1],
        quantity_delta: params[2], quantity_after: params[3], reason: params[4],
        actor_user_id: params[5], source: params[6], order_id: params[7],
        order_item_id: params[8], listing_id: params[9], idempotency_key: key,
        metadata: JSON.parse(params[11]), created_at: new Date().toISOString(),
      };
      this.movements.set(key, row);
      return { rows: [row] };
    }
    if (compact.startsWith('update product_inventory set quantity_on_hand')) {
      this.quantity = Number(params[0]);
      return { rows: [] };
    }
    if (compact.startsWith('update product_inventory set quantity_reserved')) {
      this.reserved = Number(params[0]);
      return { rows: [] };
    }
    if (compact.startsWith('update product_inventory set quantity_pending_return')) {
      this.pendingReturn = Number(params[0]);
      return { rows: [] };
    }
    if (compact.startsWith('insert into return_stock_approvals')) {
      const itemId = Number(params[1]);
      if (this.approvals.has(itemId)) return { rows: [] };
      this.approvals.set(itemId, {
        id: this.approvals.size + 1,
        order_id: params[0],
        order_item_id: itemId,
        product_id: params[2],
        quantity: params[3],
        status: 'pending',
      });
      return { rows: [{ id: this.approvals.get(itemId).id }] };
    }
    if (compact.startsWith('select id, product_id, quantity')) {
      return {
        rows: [...this.approvals.values()].filter((row) => (
          Number(row.order_id) === Number(params[0]) && row.status === 'pending'
        )),
      };
    }
    if (compact.startsWith('update return_stock_approvals')) {
      const row = [...this.approvals.values()].find((item) => item.id === Number(params[0]));
      if (row) {
        row.status = 'approved';
        row.reviewed_by = params[1];
      }
      return { rows: [] };
    }
    if (compact.startsWith('select id from orders')) return { rows: [{ id: params[0] }] };
    if (compact.includes('from product_listings l') && compact.includes('l.seller_sku=$3')) {
      const matches = this.listings.filter((listing) => (
        listing.channel_code === params[0] && listing.company_id === params[1]
        && listing.seller_sku === params[2] && listing.status === 'active'
      ));
      return { rows: matches.slice(0, 1) };
    }
    if (compact.includes('from product_listings l') && compact.includes('l.shop_sku=$3')) {
      const matches = this.listings.filter((listing) => (
        listing.channel_code === params[0] && listing.company_id === params[1]
        && listing.shop_sku === params[2] && listing.status === 'active'
      ));
      return { rows: matches.slice(0, 2) };
    }
    if (compact.startsWith('update order_items set product_id') && compact.includes('stock_applied_quantity')) {
      const id = Number(params[6]);
      const item = this.items.get(id);
      Object.assign(item, {
        product_id: params[0], listing_id: params[1], main_sku: params[2], stock_state: params[3],
        stock_applied_quantity: Number(params[4]), stock_revision: Number(params[5]),
      });
      return { rows: [] };
    }
    if (compact.startsWith('update order_items set product_id')) {
      const id = Number(params[4]);
      const item = this.items.get(id);
      Object.assign(item, { product_id: params[0], listing_id: params[1], main_sku: params[2], stock_state: params[3] });
      return { rows: [] };
    }
    if (compact.includes('from order_items where order_id=$1') && compact.includes('stock_applied_quantity > 0')) {
      return { rows: [...this.items.values()].filter((item) => item.stock_applied_quantity > 0) };
    }
    if (compact.includes('from order_items') && compact.includes('stock_state <> \'reversed\'')) {
      return { rows: [...this.items.values()].filter((item) => item.stock_state !== 'reversed') };
    }
    throw new Error(`Query no simulada: ${compact}`);
  }
}

test('el historial muestra la conciliación autoritativa y los movimientos posteriores', async () => {
  let statement = '';
  const db = {
    async query(sql) {
      statement = sql.replace(/\s+/g, ' ').trim();
      return { rows: [{
        id: 1,
        product_id: 5,
        movement_type: 'sale',
        quantity_delta: '-1',
        quantity_after: '8',
        source: 'reconciliation',
        metadata: { reconciliationRunId: 1 },
        effective_at: '2026-08-21T20:00:00.000Z',
        created_at: '2026-08-24T21:25:34.429Z',
        total_count: '1',
      }] };
    },
  };

  const result = await listMovements(5, {}, db);

  assert.match(statement, /with latest_reconciliation as/i);
  assert.match(statement, /m\.metadata->>'reconciliationRunId'=lr\.id::text/i);
  assert.match(statement, /m\.created_at>lr\.applied_at/i);
  assert.equal(result.movements[0].effectiveAt, '2026-08-21T20:00:00.000Z');
  assert.equal(result.totalCount, 1);
});

function listing(overrides = {}) {
  return {
    listing_id: 71,
    product_id: 5,
    channel_code: 'falabella',
    company_id: 1,
    seller_sku: 'FA-123',
    shop_sku: 'SHOP-1',
    main_sku: 'ZEN-CAMISETA-M',
    product_name: 'Camiseta M',
    product_status: 'active',
    quantity_on_hand: 10,
    status: 'active',
    ...overrides,
  };
}

function item(overrides = {}) {
  return {
    id: 101,
    external_item_id: 'EXT-1',
    sku: 'FA-123',
    provider_sku: 'SHOP-1',
    quantity: 2,
    product_id: null,
    listing_id: null,
    main_sku: null,
    stock_state: 'none',
    stock_applied_quantity: 0,
    stock_revision: 0,
    ...overrides,
  };
}

function phaseInput(db, upsertedItems, overrides = {}) {
  const { persisted, ...rest } = overrides;
  return {
    db,
    existing: null,
    persisted: {
      id: 20,
      company_id: 1,
      order_status: 'confirmed',
      fulfillment_status: 'ready_to_ship',
      external_order_number: '3999111222',
      ordered_at: INVENTORY_LISTEN_FROM_AT,
      ...persisted,
    },
    account: { id: 3, channelCode: 'falabella', settings: {} },
    upsertedItems,
    doomedItems: [],
    source: 'sync',
    enabled: true,
    ...rest,
  };
}

test('aplica un movimiento con saldo materializado e idempotencia', async () => {
  const db = new InventoryDb(10);
  const first = await applyInventoryMovement(db, {
    productId: 5, quantityDelta: -2, movementType: 'sale', source: 'order',
    idempotencyKey: 'sale:order_item:101:rev:1', allowNegative: false,
  });
  const replay = await applyInventoryMovement(db, {
    productId: 5, quantityDelta: -2, movementType: 'sale', source: 'order',
    idempotencyKey: 'sale:order_item:101:rev:1', allowNegative: false,
  });
  assert.equal(first.applied, true);
  assert.equal(replay.applied, false);
  assert.equal(db.quantity, 8);
  assert.equal(db.movements.size, 1);
});

test('snapshot Falabella separa precio regular/oferta y suma stock seller más fulfillment', () => {
  const snapshot = falabellaPublicationSnapshot({
    name: 'Producto publicado',
    businessUnits: [{
      operatorCode: 'fape', price: '750.00', specialPrice: '290.00',
      specialFromDate: '2026-02-03 00:00:00', specialToDate: '2043-02-11 23:59:59',
      status: 'active', isPublished: '1',
    }],
  }, {
    sellerWarehouseQuantity: 2,
    fulfillmentQuantity: 3,
    availableQuantity: 5,
    sellerWarehouses: [{ facilityId: 'seller-1', quantity: 2 }],
    fulfillmentWarehouses: [{ warehouseId: '1000', quantity: 3 }],
  }, new Date('2026-08-08T12:00:00Z'));
  assert.equal(snapshot.metadata.regularPrice, 750);
  assert.equal(snapshot.metadata.offerPrice, 290);
  assert.equal(snapshot.metadata.effectivePrice, 290);
  assert.equal(snapshot.metadata.offerIsActive, true);
  assert.equal(snapshot.availableQuantity, 5);
  assert.equal(snapshot.metadata.stockSource, 'falabella_get_stock');
});

test('snapshot Falabella muestra cero cuando la tienda pública no ofrece la publicación', () => {
  const snapshot = falabellaPublicationSnapshot({
    name: 'Bastón de trekking',
    status: 'active',
    qcStatus: 'approved',
    businessUnits: [{
      operatorCode: 'fape', status: 'active', isPublished: '1', price: '24.00',
    }],
  }, {
    sellerWarehouseQuantity: 200,
    fulfillmentQuantity: 0,
    availableQuantity: 200,
  }, new Date('2026-08-24T12:00:00Z'), {
    publicAvailability: {
      status: 'unavailable',
      isPublished: false,
      isOutOfStock: true,
      checkedAt: '2026-08-24T12:00:00.000Z',
    },
  });

  assert.equal(snapshot.availableQuantity, 0);
  assert.equal(snapshot.metadata.reportedAvailableQuantity, 200);
  assert.equal(snapshot.metadata.publicAvailabilityStatus, 'unavailable');
  assert.equal(snapshot.metadata.publicIsPublished, false);
  assert.equal(snapshot.metadata.publicIsOutOfStock, true);
});

test('consulta la disponibilidad pública de Falabella usando los datos livianos de Next', async () => {
  const requests = [];
  const responses = [
    `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      buildId: 'build-123',
      props: { pageProps: { productData: { isPublished: false, isOutOfStock: true } } },
    })}</script>`,
    JSON.stringify({
      pageProps: { productData: { isPublished: true, isOutOfStock: false } },
    }),
  ];
  const fetchImpl = async (url) => {
    requests.push(String(url));
    return {
      ok: true,
      text: async () => responses.shift(),
    };
  };

  const availability = await fetchFalabellaPublicAvailabilities([
    {
      sellerSku: 'BEAUTY-1',
      url: 'https://www.falabella.com.pe/falabella-pe/product/100/baston-negro/101',
    },
    {
      sellerSku: 'LIMBO-1',
      url: 'https://www.falabella.com.pe/falabella-pe/product/200/baston-rojo/201',
    },
  ], { fetchImpl, now: new Date('2026-08-24T12:00:00Z'), concurrency: 1 });

  assert.equal(availability.get('BEAUTY-1')?.status, 'unavailable');
  assert.equal(availability.get('LIMBO-1')?.status, 'available');
  assert.equal(requests.length, 2);
  assert.match(requests[1], /\/_next\/data\/build-123\/product\.json/);
  assert.match(requests[1], /productId=200/);
  assert.match(requests[1], /variantId=201/);
});

test('un producto no autorizado conserva el stock reportado aunque no sea vendible', () => {
  const remote = {
    name: 'Pulsera para camara Gopro accesorio',
    status: 'active',
    qcStatus: 'rejected',
    contentScore: 22,
    businessUnits: [{
      operatorCode: 'fape', status: 'active', isPublished: '0', stock: '100',
    }],
  };
  const snapshot = falabellaPublicationSnapshot(remote, {
    sellerWarehouseQuantity: 100,
    fulfillmentQuantity: 0,
    availableQuantity: 100,
  });

  assert.equal(snapshot.availableQuantity, 100);
  assert.equal(snapshot.metadata.reportedAvailableQuantity, 100);
  assert.equal(snapshot.metadata.isSellable, false);
  assert.equal(snapshot.metadata.sellabilityReason, 'qc_not_approved');
  assert.deepEqual(snapshot.metadata.sellabilityReasons, ['qc_not_approved', 'not_published']);
  assert.equal(snapshot.metadata.contentScore, 22);
  assert.equal(falabellaPublicationState(remote).isSellable, false);
});

test('GetStock se consulta por lotes de 1000 SKU', async () => {
  const calls = [];
  const sellerSkus = Array.from({ length: 1001 }, (_, index) => `SKU-${index}`);
  const stocks = await fetchFalabellaStocks({
    falabellaGetStock: async (input) => {
      calls.push(input);
      return { ok: true, stocks: input.sellerSkus.map((sellerSku) => ({ sellerSku, availableQuantity: 1 })) };
    },
  }, 2, [...sellerSkus, sellerSkus[0]]);

  assert.deepEqual(calls.map(({ sellerSkus: batch }) => batch.length), [1000, 1]);
  assert.equal(stocks.length, 1001);
});

test('rechaza stock negativo antes de insertar el ledger', async () => {
  const db = new InventoryDb(1);
  await assert.rejects(() => applyInventoryMovement(db, {
    productId: 5, quantityDelta: -2, movementType: 'sale', source: 'order',
    idempotencyKey: 'sale:too-much', allowNegative: false,
  }), InsufficientStockError);
  assert.equal(db.quantity, 1);
  assert.equal(db.movements.size, 0);
});

test('resuelve por seller SKU con aislamiento de company y detecta shop SKU ambiguo', async () => {
  const db = new InventoryDb();
  db.listings.push(
    listing(),
    listing({ listing_id: 72, company_id: 2, seller_sku: 'FB-999' }),
    listing({ listing_id: 73, seller_sku: 'OTHER', shop_sku: 'AMB' }),
    listing({ listing_id: 74, seller_sku: 'OTHER-2', shop_sku: 'AMB' }),
  );
  const first = await resolveListing(db, { channelCode: 'falabella', companyId: 1, sellerSku: 'FA-123' });
  const second = await resolveListing(db, { channelCode: 'falabella', companyId: 2, sellerSku: 'FB-999' });
  const ambiguous = await resolveListing(db, { channelCode: 'falabella', companyId: 1, sellerSku: 'missing', shopSku: 'AMB' });
  assert.equal(first.product.id, 5);
  assert.equal(second.product.id, 5);
  assert.deepEqual(ambiguous, { unmapped: true, reason: 'ambiguous_shop_sku' });
});

test('reconcilia cantidades oscilantes con revisiones monotónicas sin doble descuento', async () => {
  const db = new InventoryDb(10);
  db.listings.push(listing());
  db.items.set(101, item());
  await stockPhase(phaseInput(db, [{ ...db.items.get(101) }]));
  assert.equal(db.quantity, 8);
  assert.equal(db.items.get(101).stock_revision, 1);

  for (const quantity of [1, 2, 1]) {
    db.items.get(101).quantity = quantity;
    await stockPhase(phaseInput(db, [{ ...db.items.get(101) }], {
      existing: { order_status: 'confirmed', fulfillment_status: 'ready_to_ship' },
    }));
  }
  assert.equal(db.quantity, 9);
  assert.equal(db.items.get(101).stock_applied_quantity, 1);
  assert.equal(db.items.get(101).stock_revision, 4);
  assert.deepEqual([...db.movements.keys()], [
    'sale:order_item:101:rev:1',
    'sale_adjust:order_item:101:rev:2',
    'sale_adjust:order_item:101:rev:3',
    'sale_adjust:order_item:101:rev:4',
  ]);
});

test('re-sync idéntico no crea movement ni reescribe cantidades', async () => {
  const db = new InventoryDb(8);
  const applied = item({ product_id: 5, listing_id: 71, main_sku: 'ZEN-CAMISETA-M', stock_state: 'applied', stock_applied_quantity: 2, stock_revision: 1 });
  db.items.set(101, applied);
  const before = db.queries.length;
  await stockPhase(phaseInput(db, [{ ...applied }], { existing: { order_status: 'confirmed', fulfillment_status: 'pending' } }));
  assert.equal(db.movements.size, 0);
  assert.equal(db.items.get(101).stock_revision, 1);
  assert.equal(db.queries.slice(before).some(({ sql }) => sql.startsWith('update order_items')), false);
});

test('líneas históricas hidratadas para ventas nunca aplican stock retroactivo', async () => {
  const db = new InventoryDb(10);
  const historical = item({
    product_id: 5,
    listing_id: 71,
    main_sku: 'ZEN-CAMISETA-M',
    stock_state: 'skipped_policy',
  });
  db.items.set(101, historical);
  const result = await stockPhase(phaseInput(db, [{ ...historical }], {
    existing: { order_status: 'confirmed', fulfillment_status: 'ready_to_ship' },
  }));
  assert.equal(result.applied, 0);
  assert.equal(db.quantity, 10);
  assert.equal(db.movements.size, 0);
  assert.equal(db.items.get(101).stock_state, 'skipped_policy');
});

test('un pedido pending reserva stock y no descuenta el almacén', async () => {
  const db = new InventoryDb(10);
  db.listings.push(listing());
  db.items.set(101, item());
  const result = await stockPhase(phaseInput(db, [{ ...db.items.get(101) }], {
    persisted: {
      id: 20, company_id: 1, order_status: 'confirmed', fulfillment_status: 'pending',
      ordered_at: INVENTORY_LISTEN_FROM_AT,
    },
  }));
  assert.equal(result.applied, 0);
  assert.equal(result.reserved, 1);
  assert.equal(db.quantity, 10);
  assert.equal(db.reserved, 2);
  assert.equal(db.movements.size, 0);
  assert.equal(db.items.get(101).stock_state, 'pending');
  assert.equal(db.items.get(101).stock_applied_quantity, 2);
});

test('un pedido pending anterior al corte no reserva ni descuenta', async () => {
  const db = new InventoryDb(10);
  db.listings.push(listing());
  db.items.set(101, item());
  const result = await stockPhase(phaseInput(db, [{ ...db.items.get(101) }], {
    persisted: {
      id: 20, company_id: 1, order_status: 'confirmed', fulfillment_status: 'pending',
      ordered_at: new Date(Date.parse(INVENTORY_LISTEN_FROM_AT) - 1000).toISOString(),
    },
  }));
  assert.equal(result.reserved, 0);
  assert.equal(result.applied, 0);
  assert.equal(db.quantity, 10);
  assert.equal(db.reserved, 0);
  assert.equal(db.items.get(101).stock_state, 'skipped_policy');
});

test('al pasar a listo para enviar la reserva deja de estar reservada y descuenta el almacén', async () => {
  const db = new InventoryDb(10);
  db.reserved = 2;
  db.items.set(101, item({
    product_id: 5, listing_id: 71, main_sku: 'ZEN-CAMISETA-M',
    stock_state: 'pending', stock_applied_quantity: 2,
  }));
  const result = await stockPhase(phaseInput(db, [{ ...db.items.get(101) }], {
    existing: { order_status: 'confirmed', fulfillment_status: 'pending' },
    persisted: {
      id: 20, company_id: 1, order_status: 'confirmed', fulfillment_status: 'ready_to_ship',
      external_order_number: '3999111222', ordered_at: INVENTORY_LISTEN_FROM_AT,
    },
  }));
  assert.equal(result.applied, 1);
  assert.equal(result.committed, 1);
  assert.equal(db.quantity, 8);
  assert.equal(db.reserved, 0);
  assert.equal(db.items.get(101).stock_state, 'applied');
});

test('cancelar un pedido reservado suelta la reserva sin movimiento de almacén', async () => {
  const db = new InventoryDb(10);
  db.reserved = 2;
  db.items.set(101, item({
    product_id: 5, listing_id: 71, main_sku: 'ZEN-CAMISETA-M',
    stock_state: 'pending', stock_applied_quantity: 2, stock_revision: 0,
  }));
  await stockPhase(phaseInput(db, [], {
    existing: { order_status: 'confirmed', fulfillment_status: 'pending' },
    persisted: {
      id: 20, company_id: 1, order_status: 'cancelled', fulfillment_status: 'cancelled',
      external_order_number: '3248709095',
    },
  }));
  assert.equal(db.quantity, 10);
  assert.equal(db.reserved, 0);
  assert.equal(db.movements.size, 0);
  assert.equal(db.items.get(101).stock_state, 'reversed');
});

test('reservar más que el disponible marketplace marca la línea y no toca el almacén', async () => {
  const db = new InventoryDb(1);
  db.listings.push(listing({ quantity_on_hand: 1 }));
  db.items.set(101, item());
  const result = await stockPhase(phaseInput(db, [{ ...db.items.get(101) }], {
    persisted: {
      id: 20, company_id: 1, order_status: 'confirmed', fulfillment_status: 'pending',
      ordered_at: '2026-09-04T18:00:00.000Z',
    },
  }));
  assert.equal(result.skipped, 1);
  assert.equal(db.quantity, 1);
  assert.equal(db.reserved, 0);
  assert.equal(db.items.get(101).stock_state, 'skipped_insufficient');
});

test('applyInventoryReservation baja el disponible y no el almacén', async () => {
  const db = new InventoryDb(10);
  const reserved = await applyInventoryReservation(db, { productId: 5, quantityDelta: 3 });
  assert.equal(reserved.quantityOnHand, 10);
  assert.equal(reserved.quantityReserved, 3);
  assert.equal(reserved.available, 7);
  assert.equal(db.quantity, 10);
  assert.equal(db.reserved, 3);
  await assert.rejects(
    () => applyInventoryReservation(db, { productId: 5, quantityDelta: 8 }),
    InsufficientStockError,
  );
  assert.equal(db.reserved, 3);
});

test('al pasar a listo para enviar descuenta el producto maestro y deja el pedido en el movimiento', async () => {
  const db = new InventoryDb(10);
  db.listings.push(listing());
  db.items.set(101, item());
  const result = await stockPhase(phaseInput(db, [{ ...db.items.get(101) }], {
    existing: { order_status: 'confirmed', fulfillment_status: 'pending' },
  }));
  assert.equal(result.applied, 1);
  assert.equal(db.quantity, 8);
  assert.equal(db.items.get(101).stock_state, 'applied');
  assert.equal(db.items.get(101).product_id, 5);
  const movement = [...db.movements.values()][0];
  assert.equal(movement.reason, 'Pedido 3999111222');
  assert.equal(movement.metadata.orderNumber, '3999111222');
  assert.equal(movement.order_id, 20);
});

test('una venta manual nace lista para enviar y descuenta con el producto indicado sin depender del flag', async () => {
  const db = new InventoryDb(10);
  db.items.set(101, item({ product_id: 5 }));
  const result = await stockPhase(phaseInput(db, [{ ...db.items.get(101) }], {
    account: { id: 9, channelCode: 'manual', settings: {} },
    source: 'manual',
    enabled: undefined,
  }));
  assert.equal(result.applied, 1);
  assert.equal(result.becameEligible, true);
  assert.equal(db.quantity, 8);
  const movement = [...db.movements.values()][0];
  assert.equal(movement.movement_type, 'sale');
  assert.equal(movement.source, 'manual');
});

test('una venta manual sin productId ni listing asociado queda marcada como no mapeada', async () => {
  const db = new InventoryDb(10);
  db.items.set(101, item());
  const result = await stockPhase(phaseInput(db, [{ ...db.items.get(101) }], {
    account: { id: 9, channelCode: 'manual', settings: {} },
    source: 'manual',
    enabled: undefined,
  }));
  assert.equal(result.applied, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.unmapped, 1);
  assert.equal(result.insufficient, 0);
  assert.equal(db.quantity, 10);
  assert.equal(db.items.get(101).stock_state, 'skipped_unmapped');
});

test('un cambio de estado sin ítems en el payload usa las líneas ya asociadas', async () => {
  const db = new InventoryDb(10);
  db.items.set(101, item({ product_id: 5, listing_id: 71, main_sku: 'ZEN-CAMISETA-M' }));
  const result = await stockPhase(phaseInput(db, [], {
    existing: { order_status: 'confirmed', fulfillment_status: 'pending' },
  }));
  assert.equal(result.applied, 1);
  assert.equal(db.quantity, 8);
  assert.equal(db.items.get(101).stock_state, 'applied');
});

test('skipped_policy sí se aplica cuando el pedido acaba de quedar listo para enviar', async () => {
  const db = new InventoryDb(10);
  const historical = item({
    product_id: 5,
    listing_id: 71,
    main_sku: 'ZEN-CAMISETA-M',
    stock_state: 'skipped_policy',
  });
  db.items.set(101, historical);
  const result = await stockPhase(phaseInput(db, [{ ...historical }], {
    existing: { order_status: 'confirmed', fulfillment_status: 'pending' },
  }));
  assert.equal(result.applied, 1);
  assert.equal(db.quantity, 8);
  assert.equal(db.items.get(101).stock_state, 'applied');
});

test('hidratación histórica con enabled false no descuenta aunque el pedido ya esté listo', async () => {
  const db = new InventoryDb(10);
  db.listings.push(listing());
  db.items.set(101, item());
  const result = await stockPhase(phaseInput(db, [{ ...db.items.get(101) }], {
    enabled: false,
  }));
  assert.equal(result.applied, 0);
  assert.equal(result.enabled, false);
  assert.equal(db.quantity, 10);
  assert.equal(db.movements.size, 0);
});

test('línea doomed se revierte antes de borrarse y conserva el ledger', async () => {
  const db = new InventoryDb(8);
  const applied = item({ product_id: 5, listing_id: 71, main_sku: 'ZEN-CAMISETA-M', stock_state: 'applied', stock_applied_quantity: 2, stock_revision: 1 });
  db.items.set(101, applied);
  await stockPhase(phaseInput(db, [], {
    existing: { order_status: 'confirmed', fulfillment_status: 'pending' },
    doomedItems: [{ ...applied }],
  }));
  assert.equal(db.quantity, 10);
  assert.equal(db.items.get(101).stock_state, 'reversed');
  assert.equal(db.items.get(101).stock_revision, 2);
  assert.equal(db.movements.has('sale_reversal:order_item:101:rev:2'), true);
});

test('stock insuficiente marketplace conserva el pedido y marca la línea para operaciones', async () => {
  const db = new InventoryDb(0);
  db.listings.push(listing({ quantity_on_hand: 0 }));
  db.items.set(101, item());
  const result = await stockPhase(phaseInput(db, [{ ...db.items.get(101) }]));
  assert.equal(result.skipped, 1);
  assert.equal(result.unmapped, 0);
  assert.equal(result.insufficient, 1);
  assert.equal(db.quantity, 0);
  assert.equal(db.movements.size, 0);
  assert.equal(db.items.get(101).stock_state, 'skipped_insufficient');
  assert.equal(db.items.get(101).stock_applied_quantity, 0);
  assert.equal(db.items.get(101).stock_revision, 0);
});

test('una reparación del sistema conserva la semántica marketplace del canal', async () => {
  const db = new InventoryDb(0);
  db.listings.push(listing({ quantity_on_hand: 0 }));
  db.items.set(101, item());
  const result = await stockPhase(phaseInput(db, [{ ...db.items.get(101) }], {
    source: 'system',
    includeSkippedPolicy: true,
  }));
  assert.equal(result.skipped, 1);
  assert.equal(db.quantity, 0);
  assert.equal(db.items.get(101).stock_state, 'skipped_insufficient');
});

test('cancelación y devolución revierten cantidades aplicadas una sola vez', async () => {
  const cancelledDb = new InventoryDb(8);
  const applied = item({ product_id: 5, listing_id: 71, main_sku: 'ZEN-CAMISETA-M', stock_state: 'applied', stock_applied_quantity: 2, stock_revision: 1 });
  cancelledDb.items.set(101, { ...applied });
  await stockPhase(phaseInput(cancelledDb, [], {
    existing: { order_status: 'confirmed', fulfillment_status: 'ready_to_ship' },
    persisted: {
      id: 20, company_id: 1, order_status: 'cancelled', fulfillment_status: 'cancelled',
      external_order_number: '3248709095',
    },
  }));
  assert.equal(cancelledDb.quantity, 10);
  const cancelledMovement = cancelledDb.movements.get('sale_reversal:order_item:101:rev:2');
  assert.equal(cancelledMovement.quantity_delta, 2);
  assert.equal(cancelledMovement.reason, 'Cancelación del pedido 3248709095');
  assert.equal(cancelledDb.pendingReturn, 0);

  const returnedDb = new InventoryDb(8);
  returnedDb.items.set(101, { ...applied });
  const returnedOrder = {
    id: 20, company_id: 1, order_status: 'completed', fulfillment_status: 'returned',
    external_order_number: '3248709095',
    returned_at: '2026-09-03T18:59:59.000Z',
  };
  await stockPhase(phaseInput(returnedDb, [], {
    existing: { order_status: 'completed', fulfillment_status: 'ready_to_ship' },
    persisted: returnedOrder,
  }));
  await stockPhase(phaseInput(returnedDb, [], {
    existing: { order_status: 'completed', fulfillment_status: 'returned' },
    persisted: returnedOrder,
  }));
  assert.equal(returnedDb.quantity, 10);
  const returnedMovement = returnedDb.movements.get('return:order_item:101:rev:2');
  assert.deepEqual([...returnedDb.movements.keys()], ['return:order_item:101:rev:2']);
  assert.equal(returnedMovement.quantity_delta, 2);
  assert.equal(returnedMovement.reason, 'Devolución del pedido 3248709095');
  assert.equal(returnedDb.pendingReturn, 0);
  assert.equal(returnedDb.approvals.size, 0);
});

test('una devolución anterior al corte de aprobación entra al stock vendible', () => {
  assert.equal(needsReturnStockApproval('2026-09-03T18:59:59.000Z'), false);
  assert.equal(needsReturnStockApproval(RETURN_STOCK_APPROVAL_FROM_AT), true);
  assert.equal(needsReturnStockApproval('2026-09-04T12:00:00.000Z'), true);
  assert.equal(needsReturnStockApproval(null), false);
});

test('una devolución desde el 3 set. 14:00 Lima queda por aprobar y no se vende', async () => {
  const db = new InventoryDb(8);
  const applied = item({
    product_id: 5, listing_id: 71, main_sku: 'ZEN-CAMISETA-M',
    stock_state: 'applied', stock_applied_quantity: 2, stock_revision: 1,
  });
  db.items.set(101, { ...applied });
  const persisted = {
    id: 20, company_id: 1, order_status: 'completed', fulfillment_status: 'returned',
    external_order_number: '3249612124',
    returned_at: '2026-09-03T20:00:00.000Z',
  };
  await stockPhase(phaseInput(db, [], {
    existing: { order_status: 'completed', fulfillment_status: 'delivered' },
    persisted,
  }));
  await stockPhase(phaseInput(db, [], {
    existing: { order_status: 'completed', fulfillment_status: 'returned' },
    persisted,
  }));
  assert.equal(db.quantity, 10);
  assert.equal(db.pendingReturn, 2);
  assert.equal(db.approvals.get(101)?.quantity, 2);
  assert.equal(db.movements.get('return:order_item:101:rev:2').reason, 'Devolución del pedido 3249612124');

  const approved = await approveReturnStock(20, 'operator-1', db);
  assert.equal(approved.approvedLines, 1);
  assert.equal(approved.approvedQuantity, 2);
  assert.equal(db.pendingReturn, 0);
  assert.equal(db.quantity, 10);
});

test('una línea cancelada o devuelta reintegra stock aunque el pedido siga listo para enviar', async () => {
  const cancelledDb = new InventoryDb(8);
  const applied = item({
    product_id: 5, listing_id: 71, main_sku: 'ZEN-CAMISETA-M',
    stock_state: 'applied', stock_applied_quantity: 2, stock_revision: 1,
    provider_status: 'canceled',
  });
  cancelledDb.items.set(101, { ...applied });
  await stockPhase(phaseInput(cancelledDb, [{ ...applied }], {
    existing: { order_status: 'confirmed', fulfillment_status: 'ready_to_ship' },
    persisted: {
      id: 20, company_id: 1, order_status: 'confirmed', fulfillment_status: 'ready_to_ship',
      external_order_number: '3248709095',
    },
  }));
  assert.equal(cancelledDb.quantity, 10);
  assert.equal(cancelledDb.items.get(101).stock_state, 'reversed');
  assert.equal(cancelledDb.movements.get('sale_reversal:order_item:101:rev:2').reason, 'Cancelación del pedido 3248709095');

  const returnedDb = new InventoryDb(8);
  const returnedItem = { ...applied, provider_status: 'returned' };
  returnedDb.items.set(101, returnedItem);
  await stockPhase(phaseInput(returnedDb, [{ ...returnedItem }], {
    existing: { order_status: 'confirmed', fulfillment_status: 'ready_to_ship' },
    persisted: {
      id: 20, company_id: 1, order_status: 'confirmed', fulfillment_status: 'ready_to_ship',
      external_order_number: '3248709095',
    },
  }));
  assert.equal(returnedDb.quantity, 10);
  assert.equal(returnedDb.movements.get('return:order_item:101:rev:2').reason, 'Devolución del pedido 3248709095');
});

test('una línea REFUNDED de Ripley se trata como devolución y no como venta', async () => {
  const db = new InventoryDb(8);
  const refunded = item({
    product_id: 5, listing_id: 71, main_sku: 'ZEN-CAMISETA-M',
    stock_state: 'applied', stock_applied_quantity: 2, stock_revision: 1,
    provider_status: 'REFUNDED',
  });
  db.items.set(101, refunded);
  await stockPhase(phaseInput(db, [{ ...refunded }], {
    persisted: {
      id: 20, company_id: 1, order_status: 'completed', fulfillment_status: 'delivered',
      external_order_number: '7902232701-A',
    },
  }));
  assert.equal(db.quantity, 10);
  assert.equal(db.items.get(101).stock_state, 'reversed');
  assert.equal(db.movements.get('return:order_item:101:rev:2').quantity_delta, 2);
});

test('un segundo sync de un pedido ya cancelado o devuelto todavía reintegra stock aplicado', async () => {
  const cancelledDb = new InventoryDb(8);
  const applied = item({
    product_id: 5, listing_id: 71, main_sku: 'ZEN-CAMISETA-M',
    stock_state: 'applied', stock_applied_quantity: 2, stock_revision: 1,
  });
  cancelledDb.items.set(101, { ...applied });
  await stockPhase(phaseInput(cancelledDb, [], {
    existing: { order_status: 'cancelled', fulfillment_status: 'cancelled' },
    persisted: {
      id: 20, company_id: 1, order_status: 'cancelled', fulfillment_status: 'cancelled',
      external_order_number: '3248709095',
    },
  }));
  assert.equal(cancelledDb.quantity, 10);
  assert.equal(cancelledDb.items.get(101).stock_state, 'reversed');
  assert.equal(cancelledDb.movements.get('sale_reversal:order_item:101:rev:2').reason, 'Cancelación del pedido 3248709095');

  await stockPhase(phaseInput(cancelledDb, [], {
    existing: { order_status: 'cancelled', fulfillment_status: 'cancelled' },
    persisted: {
      id: 20, company_id: 1, order_status: 'cancelled', fulfillment_status: 'cancelled',
      external_order_number: '3248709095',
    },
  }));
  assert.equal(cancelledDb.quantity, 10);
  assert.deepEqual([...cancelledDb.movements.keys()], ['sale_reversal:order_item:101:rev:2']);

  const returnedDb = new InventoryDb(8);
  returnedDb.items.set(101, { ...applied });
  const returnedOrder = {
    id: 20, company_id: 1, order_status: 'completed', fulfillment_status: 'returned',
    external_order_number: '3248709095',
  };
  await stockPhase(phaseInput(returnedDb, [], {
    existing: returnedOrder,
    persisted: returnedOrder,
  }));
  assert.equal(returnedDb.quantity, 10);
  assert.equal(returnedDb.movements.get('return:order_item:101:rev:2').reason, 'Devolución del pedido 3248709095');
});

test('una cancelación reintegra stock aplicado aunque el catálogo esté apagado', async () => {
  const db = new InventoryDb(4);
  const applied = item({
    product_id: 5, listing_id: 71, main_sku: 'ZEN-CAMISETA-M',
    stock_state: 'applied', stock_applied_quantity: 1, stock_revision: 1, quantity: 1,
  });
  db.items.set(101, { ...applied });
  await stockPhase(phaseInput(db, [], {
    enabled: false,
    existing: { order_status: 'confirmed', fulfillment_status: 'ready_to_ship' },
    persisted: {
      id: 20, company_id: 1, order_status: 'cancelled', fulfillment_status: 'cancelled',
      external_order_number: '3248709095',
    },
  }));
  assert.equal(db.quantity, 5);
  const movement = db.movements.get('sale_reversal:order_item:101:rev:2');
  assert.equal(movement.quantity_delta, 1);
  assert.equal(movement.reason, 'Cancelación del pedido 3248709095');
});

test('primer ingest cancelado no intenta resolver ni descontar stock', async () => {
  const db = new InventoryDb(10);
  db.listings.push(listing());
  db.items.set(101, item());
  await stockPhase(phaseInput(db, [{ ...db.items.get(101) }], {
    persisted: { id: 20, company_id: 1, order_status: 'cancelled', fulfillment_status: 'cancelled' },
  }));
  assert.equal(db.quantity, 10);
  assert.equal(db.movements.size, 0);
  assert.equal(db.items.get(101).stock_state, 'none');
});

test('hit idempotente inesperado no pisa applied quantity ni revision', async () => {
  const db = new InventoryDb(9);
  const applied = item({ quantity: 2, product_id: 5, listing_id: 71, main_sku: 'ZEN-CAMISETA-M', stock_state: 'applied', stock_applied_quantity: 1, stock_revision: 1 });
  db.items.set(101, applied);
  db.movements.set('sale_adjust:order_item:101:rev:2', {
    id: 99, product_id: 5, movement_type: 'sale_adjust', quantity_delta: -1,
    quantity_after: 8, source: 'sync', order_id: 20, order_item_id: 101,
    listing_id: 71, idempotency_key: 'sale_adjust:order_item:101:rev:2', metadata: {},
  });
  await stockPhase(phaseInput(db, [{ ...applied }], {
    existing: { order_status: 'confirmed', fulfillment_status: 'ready_to_ship' },
  }));
  assert.equal(db.quantity, 9);
  assert.equal(db.items.get(101).stock_applied_quantity, 1);
  assert.equal(db.items.get(101).stock_revision, 1);
});

test('sanitiza el SKU importado de forma estable', () => {
  assert.equal(sanitizeMainSku('  Camiséta negra / M  '), 'CAMISETA-NEGRA-M');
  assert.match(sanitizeMainSku('***', 'fallback'), /^FAL-[A-F0-9]{10}$/);
});

test('el sync completo solo acepta productos activos y publicados', () => {
  const product = {
    name: 'Camiseta Faja Reductora',
    status: 'active',
    qcStatus: 'approved',
    businessUnits: [{ operatorCode: 'fape', status: 'active', isPublished: '1' }],
  };
  assert.equal(isFalabellaActivePublished(product), true);
  assert.equal(isFalabellaActivePublished({ ...product, status: 'inactive' }), false);
  assert.equal(isFalabellaActivePublished({
    ...product,
    businessUnits: [{ operatorCode: 'fape', status: 'active', isPublished: '0' }],
  }), false);
  assert.equal(isFalabellaActivePublished({
    ...product,
    businessUnits: [{ operatorCode: 'fape', status: 'inactive', isPublished: '1' }],
  }), false);
  assert.equal(isFalabellaActivePublished({ ...product, qcStatus: 'rejected' }), false);
});

test('la identidad canónica distingue variantes y une títulos equivalentes', () => {
  assert.equal(
    falabellaCanonicalIdentity({ name: 'Cámara Endoscópica HD', color: 'Negro', size: 'M' }),
    falabellaCanonicalIdentity({ name: 'Camara endoscopica  HD', color: 'negro', size: 'm' }),
  );
  assert.notEqual(
    falabellaCanonicalIdentity({ name: 'Camiseta Faja', color: 'Blanco', size: 'M' }),
    falabellaCanonicalIdentity({ name: 'Camiseta Faja', color: 'Blanco', size: 'L' }),
  );
});

test('la asociación multiseñal infiere la variante y une títulos comerciales equivalentes', () => {
  const canonical = {
    name: 'Camiseta Faja Reductora Remodela Abdomen Hombres Vivid Bvd',
    color: 'Blanco',
    size: 'XL',
    price: 24,
  };
  const seller = {
    name: 'Camiseta Faja Remodela Abdomen Hombres Bvd - Blanco XL',
    price: 23.98,
  };
  const profile = falabellaAssociationProfile(seller);
  assert.equal(profile.color, 'blanco');
  assert.equal(profile.size, 'XL');
  const match = scoreFalabellaAssociation(canonical, seller);
  assert.equal(match.eligible, true);
  assert.ok(match.confidence >= 0.82);
});

test('marca genérica no bloquea una asociación entre canales', () => {
  const match = scoreFalabellaAssociation({
    name: 'Bicicleta Para Niños Equilibrio Balance Sin Pedales Blanco',
    brand: 'GENERICO',
  }, {
    name: 'Bicicleta para niños equilibrio balance bike sin pedales blanco',
    brand: 'LIMBO',
  });

  assert.equal(match.eligible, true);
  assert.notEqual(match.reason, 'brand_conflict');
});

test('acepta un título existente contenido en una descripción comercial más larga', () => {
  const match = scoreFalabellaAssociation({
    name: 'Mochila Limbo camping impermeable trekking negra 40L resistente y con diseño ergonómico',
  }, {
    name: 'Mochila de camping trekking negra 40L resistente',
  });

  assert.equal(match.eligible, true);
  assert.ok(match.confidence >= 0.82);
});

test('asocia las tres publicaciones verificadas de la pulsera para cámara', () => {
  const groups = groupFalabellaCatalogRecords([
    {
      company: { id: 1, name: 'LIMBO' },
      remote: {
        name: 'Muñequera Pulsera Giratoria para Cámara GoPro Accesorios',
        sellerSku: 'CAM4563011987', color: 'Negro', price: 9.9,
      },
    },
    {
      company: { id: 2, name: 'DOLPHIN' },
      remote: {
        name: 'Pulsera para camara Gopro accesorio',
        sellerSku: 'PDG44345564', color: 'Negro', size: 'Talla única', price: 9.95,
      },
    },
    {
      company: { id: 10, name: 'LA TIENDA DEL VIAJERO' },
      remote: {
        name: 'Pulsera para camara de acción - accesorio de mano',
        sellerSku: '129650681', color: 'NEGRO', price: 9.99,
      },
    },
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].records.length, 3);
  assert.deepEqual(
    groups[0].records.map(({ remote }) => remote.sellerSku).sort(),
    ['129650681', 'CAM4563011987', 'PDG44345564'],
  );

  const variantGroups = groupFalabellaCatalogRecords([
    { company: { id: 1 }, remote: { name: 'Pulsera para camara Gopro accesorio', sellerSku: 'BLACK', color: 'Negro' } },
    { company: { id: 2 }, remote: { name: 'Pulsera para camara Gopro accesorio', sellerSku: 'WHITE', color: 'Blanco' } },
  ]);
  assert.equal(variantGroups.length, 2);
});

test('la asociación no mezcla variantes ni familias distintas', () => {
  const canonical = {
    name: 'Camiseta Faja Reductora Remodela Abdomen Hombres Vivid Bvd',
    color: 'Blanco',
    size: 'XL',
    price: 24,
  };
  assert.equal(scoreFalabellaAssociation(canonical, {
    name: 'Camiseta Faja Remodela Abdomen Hombres Bvd - Blanco M',
    price: 23.98,
  }).reason, 'variant_conflict');
  assert.equal(scoreFalabellaAssociation(canonical, {
    name: 'Camiseta deportiva para hombre entrenamiento diario',
    color: 'Blanco',
    size: 'XL',
    price: 23.98,
  }).eligible, false);
});

test('el agrupador no fusiona publicaciones parecidas del mismo seller por heurística', () => {
  const company = { id: 1, name: 'LIMBO' };
  const groups = groupFalabellaCatalogRecords([
    { company, remote: { name: 'Silla De Comer Multifuncional Para Bebe Reclinable Plegable', sellerSku: 'A' } },
    { company, remote: { name: 'Silla De Comer Multifuncional Para Bebe Plegable Rosado', sellerSku: 'B' } },
  ]);
  assert.equal(groups.length, 2);
});

test('un consenso de tres sellers admite un duplicado del mismo seller sin mezclar variantes', () => {
  const base = 'Zapatera Organizador De Metal 9 Niveles Zapatero';
  const groups = groupFalabellaCatalogRecords([
    { company: { id: 1 }, remote: { name: base, sellerSku: 'A', color: 'Negro', price: 44.9 } },
    { company: { id: 2 }, remote: { name: base, sellerSku: 'B', color: 'Negro', price: 44.9 } },
    { company: { id: 3 }, remote: { name: base, sellerSku: 'C', color: 'Negro', price: 44.9 } },
    { company: { id: 1 }, remote: { name: `${base} Ropero`, sellerSku: 'D', color: 'Negro', price: 44.9 } },
    { company: { id: 1 }, remote: { name: base, sellerSku: 'E', color: 'Blanco', price: 44.9 } },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups.find((group) => group.records.some(({ remote }) => remote.sellerSku === 'D')).records.length, 4);
  assert.equal(groups.find((group) => group.records.some(({ remote }) => remote.sellerSku === 'E')).records.length, 1);
});

test('la misma imagen binaria confirma duplicados del mismo seller sin mezclar tallas', () => {
  const company = { id: 1, name: 'LIMBO' };
  const shared = 'sha256:misma-imagen';
  const duplicateGroups = groupFalabellaCatalogRecords([
    { company, remote: { name: 'Capucha Polar Cortaviento Mascara Termica Deportes', color: 'Negro', sellerSku: 'A', imageFingerprint: shared } },
    { company, remote: { name: 'Capucha Polar Máscara Térmica para Deportes', color: 'Negro', sellerSku: 'B', imageFingerprint: shared } },
  ]);
  assert.equal(duplicateGroups.length, 1);

  const variantGroups = groupFalabellaCatalogRecords([
    { company, remote: { name: 'Chaqueta Impermeable Verde', size: 'M', sellerSku: 'M', imageFingerprint: shared } },
    { company: { id: 2, name: 'DOLPHIN' }, remote: { name: 'Chaqueta Impermeable Verde', size: 'S', sellerSku: 'S', imageFingerprint: shared } },
  ]);
  assert.equal(variantGroups.length, 2);

  const numberedModelGroups = groupFalabellaCatalogRecords([
    { company, remote: { name: 'Adorno de Pared Elegante N°1', sellerSku: 'N1', imageFingerprint: shared } },
    { company: { id: 2, name: 'DOLPHIN' }, remote: { name: 'Adorno de Pared Elegante N2', sellerSku: 'N2', imageFingerprint: shared } },
  ]);
  assert.equal(numberedModelGroups.length, 2);
});

test('asocia las mantas Mylar confirmadas aunque una publicación destaque 140x210', () => {
  const groups = groupFalabellaCatalogRecords([
    {
      company: { id: 2, name: 'DOLPHIN' },
      remote: {
        name: 'Manta Térmica Aluminizada Mylar Emergencia Trekking Camping',
        color: 'Plateado', sellerSku: 'MTC12309843', price: 7.99,
      },
    },
    {
      company: { id: 3, name: 'MANTA RAYA' },
      remote: {
        name: 'Manta Térmica Emergencia Desastres Supervivencia 140x210',
        color: 'plateado', sellerSku: 'MAN66332781', price: 8.98,
      },
    },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].records.length, 2);
  assert.match(groups[0].records[1].association.signals.join(' '), /verified_family:manta-termica-mylar-140x210/);
});

test('asocia la mochila viral USB con la publicación de trabajo confirmada', () => {
  const shopSkus = [
    '144952457', '144962095', '144958641', '144962778',
    '144957751', '144956187', '146325129',
  ];
  const groups = groupFalabellaCatalogRecords(shopSkus.map((shopSku, index) => ({
    company: { id: index + 1 },
    remote: {
      name: shopSku === '146325129'
        ? 'Mochila Para Trabajo Viaje Negocios Impermeable USB Portatil Original'
        : 'Mochila Viral Tiktok Expandible Juvenil USB Laptop',
      sellerSku: `MOCHILA-${index}`,
      shopSku,
      color: 'Negro',
    },
  })));

  assert.equal(groups.length, 1);
  assert.equal(groups[0].records.length, 7);
  assert.match(groups[0].records.at(-1).association.signals.join(' '), /verified_family:mochila-viral-usb/);
});

test('asocia las publicaciones verificadas de la mochila deportiva de 40 litros', () => {
  const publications = [
    ['129620781', 'Mochila Maleta Deportiva Sport Laptop Morral Viaje Camping Negra', 'Negro'],
    ['129756078', 'Mochila Maleta Deportiva Sport Laptop Morral Viaje Camping Negra', 'Negro'],
    ['129727176', 'Mochila Maleta Deportiva Sport Laptop Viaje Camping Negro', 'Negro'],
    ['129591195', 'Mochila Maleta Deportiva 40 Litros Sport Viaje Laptop Negro', ''],
    ['131589787', 'Mochila Maleta Deportiva 40 Litros Sport Viaje Laptop Negro', 'Negro'],
    ['115743341', 'Mochila Maleta Deportiva 40 Litros Sport Laptop Viaje Negro', ''],
    ['129647156', 'Mochila Maleta Deportiva Sport Laptop Viaje Camping Negro', 'Negro'],
  ];
  const groups = groupFalabellaCatalogRecords(publications.map(([shopSku, name, color], index) => ({
    company: { id: index + 1 },
    remote: { name, color, shopSku, sellerSku: `MOC-40L-${index}` },
  })));

  assert.equal(groups.length, 1);
  assert.equal(groups[0].records.length, 7);
  assert.match(groups[0].records.at(-1).association.signals.join(' '), /verified_family:mochila-deportiva-40l/);
});

test('asocia las publicaciones verificadas de la mochila trekking de 45 litros', () => {
  const shopSkus = [
    '144952628', '144959236', '144962066', '144958289', '144962740', '156499931',
    '144959232', '144962068', '144958529', '144962742', '144957836', '144957838', '144956330', '144956349',
  ];
  const groups = groupFalabellaCatalogRecords(shopSkus.map((shopSku, index) => ({
    company: { id: (index % 9) + 1 },
    remote: {
      name: shopSku === '156499931'
        ? 'Mochila Trekking Camping Senderismo 45 litros Outdoor Impermeable'
        : 'Mochila Trekking Camping Senderismo 45L Outdoor Impermeable',
      color: shopSku === '156499931' ? 'Negro' : '',
      shopSku,
      sellerSku: `MOC-45L-${index}`,
    },
  })));

  assert.equal(groups.length, 1);
  assert.equal(groups[0].records.length, 14);
  assert.match(groups[0].records.at(-1).association.signals.join(' '), /verified_family:mochila-trekking-45l/);
});

test('asocia las capuchas polar verificadas aunque falte el color en un seller', () => {
  const shopSkus = [
    '115717657', '135891757', '155435960', '129759067', '149672431', '156500250', '140708239', '129646966',
  ];
  const groups = groupFalabellaCatalogRecords(shopSkus.map((shopSku, index) => ({
    company: { id: index + 1 },
    remote: {
      name: 'Capucha Polar Cortaviento Mascara 6 En 1 Termica Deportes',
      color: shopSku === '140708239' ? '' : 'Negro',
      shopSku,
      sellerSku: `CAP-${index}`,
    },
  })));

  assert.equal(groups.length, 1);
  assert.equal(groups[0].records.length, 8);
  assert.match(groups[0].records.at(-1).association.signals.join(' '), /verified_family:capucha-polar-6-en-1/);
});

test('asocia la mochila expandible verificada de Higher con el resto de sellers', () => {
  const shopSkus = ['144951810', '144962075', '144958812', '144957741', '156499963', '144957048'];
  const groups = groupFalabellaCatalogRecords(shopSkus.map((shopSku, index) => ({
    company: { id: index + 1 },
    remote: {
      name: shopSku === '144951810'
        ? 'Mochila Expandible para Viaje Oficina Laptop USB Equipaje de mano Aerolineas'
        : 'Mochila Expandible para Viaje Oficina Equipaje de mano Aerolineas',
      color: 'Negro',
      shopSku,
      sellerSku: `EXP-${index}`,
    },
  })));

  assert.equal(groups.length, 1);
  assert.equal(groups[0].records.length, 6);
  assert.match(groups[0].records.at(-1).association.signals.join(' '), /verified_family:mochila-expandible-viaje/);
});

test('asocia la bici de equilibrio blanca aunque Falabella mande BLANCO CON NEGRO', () => {
  const whites = [
    ['156503857', 'Blanco'],
    ['131594395', 'blanco'],
    ['129623394', 'Blanco'],
    ['129767451', 'Blanco'],
    ['129724281', 'Blanco'],
    ['140547656', 'Blanco'],
    ['129646414', 'Blanco'],
    ['156581461', 'BLANCO CON NEGRO'],
  ];
  const groups = groupFalabellaCatalogRecords([
    ...whites.map(([shopSku, color], index) => ({
      company: { id: index + 1 },
      remote: {
        name: shopSku === '156581461'
          ? 'Bicicleta Para Niños Equilibrio Balance Bike Sin Pedales BLANCO'
          : 'Bicicleta Para Niños Equilibrio Balance Sin Pedales Blanco',
        color,
        shopSku,
        sellerSku: `BICI-BLANCO-${index}`,
      },
    })),
    {
      company: { id: 20 },
      remote: {
        name: 'Bicicleta Para Niños Equilibrio Balance Sin Pedales Negro',
        color: 'Negro',
        shopSku: '999999001',
        sellerSku: 'BICI-NEGRO',
      },
    },
  ]);

  assert.equal(groups.length, 2);
  const white = groups.find((group) => group.records.length === 8);
  assert.ok(white);
  assert.match(white.records[0].association.signals.join(' '), /verified_family:bici-equilibrio-blanco/);
});

test('asocia las publicaciones verificadas de las pilas AA recargables USB-C', () => {
  const groups = groupFalabellaCatalogRecords([
    {
      company: { id: 9 },
      remote: {
        name: 'Pilas recargables AA de 15V con cable tipo C',
        shopSku: '140747083', sellerSku: 'PILAS-AA-A',
      },
    },
    {
      company: { id: 10 },
      remote: {
        name: 'Pilas recargables AA de 1.5V con cable tipo C - UNIDAD',
        shopSku: '156581151', sellerSku: 'PILAS-AA-B',
      },
    },
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].records.length, 2);
  assert.match(groups[0].records.at(-1).association.signals.join(' '), /verified_family:pilas-aa-recargables-usb-c/);
});

test('mantiene separadas las tres variantes físicas verificadas de sillas de comer', () => {
  const publications = [
    ['128545421', 'Silla De Comer Multifuncional Para Bebe Reclinable Plegable'],
    ['129551348', 'Silla De Comer Multifuncional Para Bebe Reclinable Plegable'],
    ['129750004', 'Silla De Comer Multifuncional Para Bebe Reclinable Plegable'],
    ['131876164', 'Silla De Comer Multifuncional Para Bebe Reclinable Plegable'],
    ['128545517', 'Silla De Comer Multifuncional Para Bebe Plegable Rosado'],
    ['131610914', 'Silla De Comer Multifuncional Para Bebe Plegable Rosada'],
    ['129551254', 'Silla De Comer Multifuncional Para Bebe Plegable Rosado'],
    ['129750010', 'Silla De Comer Multifuncional Para Bebe Reclinable Rosa'],
    ['136344532', 'Silla De Comer Multifuncional Para Bebe Plegable Rosado'],
    ['129741409', 'Silla De Comer Multifuncional Para Bebe Plegable Rosado'],
    ['135888322', 'Silla De Comer Multifuncional Para Bebe Plegable Rosado'],
    ['129645938', 'Silla De Comer Multifuncional Para Bebe Plegable Rosado'],
    ['144962663', 'Silla de Comer para Bebé Multifuncional Evolutiva Rosa'],
  ];
  const groups = groupFalabellaCatalogRecords(publications.map(([shopSku, name], index) => ({
    company: { id: index + 1 },
    remote: { name, shopSku, sellerSku: `SILLA-${index}` },
  })));

  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map((group) => group.records.length).sort((left, right) => left - right), [1, 4, 8]);
});

test('mantiene separadas las sillas evolutivas por color', () => {
  const groups = groupFalabellaCatalogRecords([
    {
      company: { id: 2 },
      remote: {
        name: 'Silla de Comer para Bebé Multifuncional Evolutiva Celeste',
        color: 'Celeste', shopSku: '144959050', sellerSku: 'SILLA-CELESTE',
      },
    },
    {
      company: { id: 7 },
      remote: {
        name: 'Silla de Comer para Bebé Multifuncional Evolutiva Rosa',
        color: 'Rosa', shopSku: '144962663', sellerSku: 'SILLA-ROSA',
      },
    },
    {
      company: { id: 10 },
      remote: {
        name: 'Silla de Comer para Bebé Multifuncional Evolutiva 3 en 1 BEIGE',
        color: 'Beige', shopSku: '156582201', sellerSku: 'SILLA-BEIGE',
      },
    },
  ]);

  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map((group) => group.records.length), [1, 1, 1]);
});

test('asocia el bolso verificado aunque Falabella reporte tallas espurias', () => {
  const publications = [
    ['144953026', 'Talla única'], ['144959434', 'Talla única'], ['144962119', 'Talla única'],
    ['144958703', 'Talla única'], ['144962811', 'Talla única'], ['144956638', 'Talla única'],
    ['152680399', 'M'], ['156500089', '20'],
  ];
  const groups = groupFalabellaCatalogRecords(publications.map(([shopSku, size], index) => ({
    company: { id: index + 1 },
    remote: {
      name: 'Bolso De Gama Alta Para Mujer Dama Gran Capacidad Cartera Lujo',
      color: 'Marrón', size, shopSku, sellerSku: `BOLSO-${index}`,
    },
  })));

  assert.equal(groups.length, 1);
  assert.equal(groups[0].records.length, 8);
});

test('asocia las camisetas verificadas por color y talla inferida del título', () => {
  const publications = [
    ['118765884', 'Camiseta Faja Reductora Remodela Abdomen Hombres Vivid Bvd', 'Blanco', 'M'],
    ['156576302', 'Camiseta Reductora Masculina para Moldear Abdomen y Pecho Blanco talla M', 'Blanco', '1'],
    ['118765883', 'Camiseta Faja Reductora Remodela Abdomen Hombres Vivid Bvd', 'Blanco', 'L'],
    ['156576358', 'Camiseta Reductora Masculina para Moldear Abdomen y Pecho Blanco talla L', 'Blanco', '1'],
    ['140704306', 'Camiseta Faja Reductora Remodela Abdomen Hombres Vivid Bvd', 'Blanco', 'XL'],
    ['140454972', 'Camiseta Reductora Masculina para Moldear Abdomen y Pecho', 'Blanco', 'XL'],
    ['156576403', 'Camiseta Reductora Masculina para Moldear Abdomen y Pecho Blanco talla XL', 'Blanco', '1'],
    ['118765881', 'Camiseta Faja Reductora Remodela Abdomen Hombres Vivid Bvd', 'Negro', 'M'],
    ['156576493', 'Camiseta Reductora Masculina para Moldear Abdomen y Pecho Negra talla M', 'Negro', '1'],
    ['118765880', 'Camiseta Faja Reductora Remodela Abdomen Hombres Vivid Bvd', 'Negro', 'L'],
    ['156576509', 'Camiseta Reductora Masculina para Moldear Abdomen y Pecho Negra talla L', 'Negro', '1'],
    ['140704198', 'Camiseta Faja Reductora Remodela Abdomen Hombres Vivid Bvd', 'Negro', 'XL'],
    ['156576540', 'Camiseta Reductora Masculina para Moldear Abdomen y Pecho Negra talla XL', 'Negro', '1'],
  ];
  const groups = groupFalabellaCatalogRecords(publications.map(([shopSku, name, color, size], index) => ({
    company: { id: index + 1 }, remote: { name, color, size, shopSku, sellerSku: `CAMISETA-${index}` },
  })));

  assert.equal(falabellaAssociationProfile(publications.map(([shopSku, name, color, size]) => ({
    shopSku, name, color, size,
  }))[1]).size, 'M');
  assert.equal(groups.length, 6);
  assert.deepEqual(groups.map((group) => group.records.length).sort((left, right) => left - right), [2, 2, 2, 2, 2, 3]);
});

test('mantiene unidas las familias consolidadas aunque Falabella cambie atributos o títulos', () => {
  const families = [
    [
      { company: { id: 1 }, remote: { shopSku: '115717657', sellerSku: 'CAP-A', name: 'Capucha Polar Cortaviento Mascara 6 En 1 Termica Deportes' } },
      { company: { id: 1 }, remote: { shopSku: '155435960', sellerSku: 'CAP-B', name: 'Capucha Polar Cortaviento Mascara 6 En 1 Termica Deportes', color: 'Negro' } },
      { company: { id: 3 }, remote: { shopSku: '129759067', sellerSku: 'CAP-C', name: 'Capucha Polar Cortaviento Mascara 6 En 1 Termica Deportes', color: 'Negro', size: 'Talla única' } },
    ],
    [
      { company: { id: 1 }, remote: { shopSku: '144959108', sellerSku: '40L-A', name: 'Mochila de camping trekking 40L - Resistente y Ergonómico' } },
      { company: { id: 2 }, remote: { shopSku: '140511766', sellerSku: '40L-B', name: 'Mochila de camping trekking Negra 40L - Resistente', color: 'Negro', size: 'L' } },
    ],
    [
      { company: { id: 1 }, remote: { shopSku: '144959372', sellerSku: 'VIAJE-A', name: 'Mochila Viajera Multifuncional medidas aerolineas', color: 'Negro', size: 'Talla única' } },
      { company: { id: 2 }, remote: { shopSku: '156500047', sellerSku: 'VIAJE-B', name: 'Mochila Viajera Multifuncional medidas aerolineas', color: 'Negro', size: '40' } },
    ],
    [
      { company: { id: 1 }, remote: { shopSku: '131601207', sellerSku: 'TOALLA-A', name: 'Toalla Deportiva Microfibra Absorvente Camping Sport Secado', color: 'Celeste' } },
      { company: { id: 2 }, remote: { shopSku: '156583836', sellerSku: 'TOALLA-B', name: 'Toalla de Microfibra Celeste 76x152 cm – Ultraligera, Secado Rápido y Alta Absorción' } },
    ],
    [
      { company: { id: 1 }, remote: { shopSku: '144962075', sellerSku: 'EXP-A', name: 'Mochila Expandible para Viaje Oficina Equipaje de mano Aerolineas', color: 'Negro', size: 'Talla única' } },
      { company: { id: 2 }, remote: { shopSku: '156499963', sellerSku: 'EXP-B', name: 'Mochila Expandible para Viaje Oficina Equipaje de mano', color: 'Negro', size: '50' } },
    ],
  ];

  for (const records of families) {
    const groups = groupFalabellaCatalogRecords(records);
    assert.equal(groups.length, 1, records[0].remote.shopSku);
    assert.equal(groups[0].records.length, records.length);
  }
});

test('asocia los adornos por sus tres diseños físicos aunque los títulos intercambien N°1/N°2/N°3', () => {
  const groups = groupFalabellaCatalogRecords([
    {
      company: { id: 1, name: 'LIMBO' },
      remote: { name: 'Adorno de Pared de Metal Estilo Elegante para tu Hogar N°3', sellerSku: 'G-L', shopSku: '140437519' },
    },
    {
      company: { id: 2, name: 'DOLPHIN' },
      remote: { name: 'Adorno de Pared de Metal Estilo Elegante para tu Hogar N°1', sellerSku: 'G-D', shopSku: '140681420' },
    },
    {
      company: { id: 3, name: 'MANTA RAYA' },
      remote: { name: 'Adorno de Pared de Metal Estilo Elegante para tu Hogar N°3', sellerSku: 'A-M', shopSku: '140716049' },
    },
    {
      company: { id: 7, name: 'YAKURUNA' },
      remote: { name: 'Adorno de Pared de Metal Estilo Elegante para tu Hogar N°1', sellerSku: 'A-Y', shopSku: '140377163' },
    },
    {
      company: { id: 7, name: 'YAKURUNA' },
      remote: { name: 'Adorno de Pared de Metal Estilo Elegante para tu Hogar N°3', sellerSku: 'R-Y', shopSku: '140377491' },
    },
    {
      company: { id: 7, name: 'YAKURUNA' },
      remote: { name: 'Adorno de Pared de Metal Estilo Elegante para tu Hogar N°2', sellerSku: 'G-Y', shopSku: '140377407' },
    },
    {
      company: { id: 1, name: 'LIMBO' },
      remote: { name: 'Adorno de Pared de Metal Estilo Elegante para tu Hogar N°2', sellerSku: 'R-L', shopSku: '140432973' },
    },
    {
      company: { id: 10, name: 'LA TIENDA DEL VIAJERO' },
      remote: { name: 'Adorno de Pared de Metal – Estilo Elegante para tu Hogar - FLORES', sellerSku: '140743808', shopSku: '156581792' },
    },
    {
      company: { id: 10, name: 'LA TIENDA DEL VIAJERO' },
      remote: { name: 'Adorno de Pared de Metal Estilo Elegante para tu Hogar - HOJAS', sellerSku: '140743699', shopSku: '156581814' },
    },
    {
      company: { id: 10, name: 'LA TIENDA DEL VIAJERO' },
      remote: { name: 'Adorno de Pared de Metal Estilo Elegante para tu Hogar - RAMAS', sellerSku: '140743750', shopSku: '156581830' },
    },
  ]);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map((group) => group.records.map(({ remote }) => remote.sellerSku).sort()).sort(), [
    ['140743699', 'A-M', 'A-Y'],
    ['140743750', 'R-L', 'R-Y'],
    ['140743808', 'G-D', 'G-L', 'G-Y'],
  ]);
});

test('el grupo usa las huellas de todos sus sellers y no solo la primera imagen', () => {
  const groups = groupFalabellaCatalogRecords([
    { company: { id: 2 }, remote: { name: 'Adorno de Pared Elegante N°1', sellerSku: 'A', imageFingerprint: 'imagen-a' } },
    { company: { id: 3 }, remote: { name: 'Adorno de Pared Elegante N°1', sellerSku: 'B', imageFingerprint: 'imagen-b' } },
    { company: { id: 1 }, remote: { name: 'Adorno Pared Elegante N1', sellerSku: 'C', imageFingerprint: 'imagen-b' } },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].records.length, 3);
});

test('un SKU externo idéntico asocia el mismo producto entre sellers', () => {
  const groups = groupFalabellaCatalogRecords([
    {
      company: { id: 3, name: 'MANTA RAYA' },
      remote: {
        name: 'Zapatera Organizador De Metal 9 Niveles Ropero Estante',
        sellerSku: 'ZAP918273411',
        color: 'Negro',
      },
    },
    {
      company: { id: 9, name: 'HIGHER' },
      remote: {
        name: 'Zapatera Organizador Metal 9 Niveles Zapatillas',
        sellerSku: 'ZAP918273411',
        color: 'Negro',
      },
    },
    {
      company: { id: 8, name: 'BEAUTY HOME' },
      remote: {
        name: 'Zapatera Organizador De Metal 9 Niveles Zapatero',
        sellerSku: 'OTRO-SKU',
        color: 'Negro',
      },
    },
  ]);
  assert.equal(groups.length, 2);
  const repeatedSkuGroup = groups.find((group) => group.records.some(({ remote }) => remote.sellerSku === 'ZAP918273411'));
  assert.equal(repeatedSkuGroup.records.length, 2);
  assert.equal(repeatedSkuGroup.records[1].association.signals.includes('seller_sku:exact'), true);
});

test('el catálogo filtra productos con uno o varios sellers desde SQL', async () => {
  const statements = [];
  const db = { query: async (sql, params) => { statements.push({ sql, params }); return { rows: [] }; } };
  await listProducts({ sellerCoverage: 'single', status: 'active' }, db);
  const listSql = statements.find((statement) => statement.sql.includes('count(*) over()'))?.sql || '';
  assert.match(listSql, /count\(distinct coverage_listing\.company_id\)[\s\S]*= 1/);
  assert.equal(statements.some((statement) => statement.sql.includes('product_id = any')), false);

  statements.length = 0;
  await listProducts({ sellerCoverage: 'none', status: 'active' }, db);
  const noSellerSql = statements.find((statement) => statement.sql.includes('count(*) over()'))?.sql || '';
  assert.match(noSellerSql, /count\(distinct coverage_listing\.company_id\)[\s\S]*= 0/);
  await assert.rejects(() => listProducts({ sellerCoverage: 'unknown' }, db), /sellerCoverage inválido/);
});

test('el buscador del catálogo incluye códigos secundarios del Excel', async () => {
  const statements = [];
  const db = { query: async (sql, params) => { statements.push({ sql, params }); return { rows: [] }; } };

  await listProducts({ search: 'G24CA', status: 'active' }, db);

  const listSql = statements.find((statement) => statement.sql.includes('count(*) over()'))?.sql || '';
  assert.match(listSql, /jsonb_array_elements_text[\s\S]*excel_codes/);
  assert.equal(statements.some((statement) => statement.params.includes('%G24CA%')), true);
});

test('el estado del maestro no depende de la publicación del canal', async () => {
  const statements = [];
  const db = { query: async (sql, params) => { statements.push({ sql, params }); return { rows: [] }; } };

  await listProducts({ status: 'active' }, db);

  const listSql = statements.find((statement) => statement.sql.includes('count(*) over()'))?.sql || '';
  const summarySql = statements.find((statement) => statement.sql.includes('as single_seller'))?.sql || '';
  assert.match(listSql, /p\.status=\$1/);
  assert.doesNotMatch(listSql, /p\.status=\$1[\s\S]*publication_listing/);
  assert.doesNotMatch(listSql, /publication_listing\.marketplace_quantity/);
  assert.match(summarySql, /count\(\*\) filter \(where p\.status='active'\) as active/);
});

test('el catálogo combina facetas profesionales y ordenamiento desde SQL', async () => {
  const statements = [];
  const db = { query: async (sql, params) => { statements.push({ sql, params }); return { rows: [] }; } };

  await listProducts({
    status: 'all',
    companyIds: '2,7',
    inventoryStatus: 'outOfStock',
    publicationStatus: 'unpublished',
    sortBy: 'sellers',
    sortDir: 'asc',
  }, db);
  const filtered = statements.find((statement) => statement.sql.includes('count(*) over()'));
  assert.ok(filtered);
  assert.doesNotMatch(filtered.sql, /p\.status <> 'archived'/);
  assert.match(filtered.sql, /company_listing\.company_id=any\(\$1::int\[\]\)/);
  assert.deepEqual(filtered.params[0], [2, 7]);
  assert.match(filtered.sql, /quantity_on_hand - i\.quantity_reserved - coalesce\(i\.quantity_pending_return, 0\)\) <= 0/);
  assert.match(filtered.sql, /not exists[\s\S]*publication_listing\.company_id=any\(\$1::int\[\]\)[\s\S]*metadata->>'isPublished'[\s\S]*metadata->>'status'[\s\S]*metadata->>'marketplaceStatus'[\s\S]*metadata->>'qcStatus'/);
  assert.match(filtered.sql, /order by listing_stats\.sellers_count asc nulls last, p\.id desc/);
  const allStatusSummary = statements.find((statement) => statement.sql.includes('as single_seller'))?.sql || '';
  assert.match(allStatusSummary, /count\(\*\) filter \(where true\) as total/);

  statements.length = 0;
  await listProducts({ inventoryStatus: 'lowStock', publicationStatus: 'published' }, db);
  const lowStock = statements.find((statement) => statement.sql.includes('count(*) over()'))?.sql || '';
  assert.match(lowStock, /quantity_on_hand - i\.quantity_reserved - coalesce\(i\.quantity_pending_return, 0\)\) > 0[\s\S]*reorder_point is not null/);
  assert.match(lowStock, /exists[\s\S]*metadata->>'isPublished'[\s\S]*='true'/);

  statements.length = 0;
  await listProducts({ inventoryStatus: 'inStock', sortBy: 'name', sortDir: 'desc' }, db);
  const inStock = statements.find((statement) => statement.sql.includes('count(*) over()'))?.sql || '';
  assert.match(inStock, /reorder_point is null or[\s\S]*> i\.reorder_point/);
  assert.match(inStock, /order by lower\(p\.name\) desc nulls last, p\.id desc/);
  assert.match(inStock, /where l\.product_id=page\.id[\s\S]*order by lower\(page\.name\) desc nulls last/);

  statements.length = 0;
  await listProducts({ sortBy: 'available', sortDir: 'asc' }, db);
  const sortedByAvailable = statements.find((statement) => statement.sql.includes('count(*) over()'))?.sql || '';
  assert.match(sortedByAvailable, /order by \(i\.quantity_on_hand - i\.quantity_reserved - coalesce\(i\.quantity_pending_return, 0\)\) asc nulls last, p\.id desc/);

  await assert.rejects(() => listProducts({ inventoryStatus: 'unknown' }, db), /inventoryStatus inválido/);
  await assert.rejects(() => listProducts({ publicationStatus: 'unknown' }, db), /publicationStatus inválido/);
  await assert.rejects(() => listProducts({ sortBy: 'unknown' }, db), /sortBy inválido/);
  await assert.rejects(() => listProducts({ sortDir: 'sideways' }, db), /sortDir inválido/);
});

test('el catálogo adjunta todas las publicaciones compactas después de paginar', async () => {
  const statements = [];
  const db = {
    query: async (sql, params) => {
      statements.push({ sql, params });
      if (sql.includes('count(*) over()')) {
        return {
          rows: [{
            id: 5,
            main_sku: 'ZEN-CAMISETA-M',
            name: 'Camiseta M',
            description: null,
            brand: null,
            status: 'active',
            attributes: {},
            barcode: null,
            image_url: null,
            reference_price: 20,
            unit: null,
            quantity_on_hand: 10,
            quantity_reserved: 1,
            available: 9,
            reorder_point: 2,
            listings_count: 1,
            sellers_count: 1,
            channels: ['falabella'],
            seller_price_min: 19.9,
            seller_price_max: 19.9,
            seller_stock_total: 4,
            created_at: '2026-08-01T00:00:00.000Z',
            updated_at: '2026-08-12T00:00:00.000Z',
            created_by: null,
            updated_by: null,
            total_count: 1,
          }],
        };
      }
      if (sql.includes('product_id = any')) {
        return {
          rows: [{
            id: 71,
            product_id: 5,
            channel_code: 'falabella',
            company_id: 8,
            company_name: 'LIMBO',
            seller_sku: 'FA-123',
            shop_sku: 'SHOP-1',
            title: 'Camiseta publicada',
            status: 'active',
            marketplace_quantity: 4,
            marketplace_synced_at: '2026-08-12T00:00:00.000Z',
            channel_account_id: 3,
            external_product_id: 'EXT-9',
            created_at: '2026-08-01T00:00:00.000Z',
            updated_at: '2026-08-12T00:00:00.000Z',
            metadata: {
              effectivePrice: 19.9,
              price: 24,
              regularPrice: 24,
              offerPrice: 19.9,
              offerIsActive: true,
              sellerWarehouseQuantity: 2,
              fulfillmentQuantity: 2,
              stockSource: 'falabella_get_stock',
              isSellable: true,
              sellabilityReason: null,
              contentScore: 88,
              isPublished: true,
              status: 'active',
              marketplaceStatus: 'active',
              qcStatus: 'approved',
              url: 'https://www.falabella.com.pe/falabella-pe/product/123',
              images: ['https://cdn.example/img.jpg'],
              marketplaceSyncedAt: '2026-08-12T00:00:00.000Z',
              associationScore: 0.9,
            },
          }],
        };
      }
      return { rows: [{}] };
    },
  };

  const listed = await listProducts({ limit: 20, offset: 40 }, db);
  const pageQuery = statements.find((statement) => statement.sql.includes('count(*) over()'));
  const listingsQuery = statements.find((statement) => (
    statement.sql.includes('product_id = any')
  ));
  assert.ok(pageQuery);
  assert.ok(listingsQuery);
  assert.match(pageQuery.sql, /limit \$\d+ offset \$\d+/i);
  assert.doesNotMatch(pageQuery.sql, /nombre_comercial/);
  assert.notEqual(pageQuery.sql, listingsQuery.sql);
  assert.match(listingsQuery.sql, /l\.product_id = any\(\$1::int\[\]\)/);
  assert.match(listingsQuery.sql, /l\.status <> 'unlinked'/);
  assert.match(pageQuery.sql, /sum\(l\.marketplace_quantity\) filter/);
  assert.deepEqual(listingsQuery.params[0], [5]);
  assert.equal(listed.products.length, 1);
  assert.equal(listed.products[0].listings.length, 1);
  const listing = listed.products[0].listings[0];
  assert.equal(listing.id, 71);
  assert.equal(listing.productId, 5);
  assert.equal(listing.channelCode, 'falabella');
  assert.equal(listing.companyId, 8);
  assert.equal(listing.companyName, 'LIMBO');
  assert.equal(listing.sellerSku, 'FA-123');
  assert.equal(listing.shopSku, 'SHOP-1');
  assert.equal(listing.title, 'Camiseta publicada');
  assert.equal(listing.status, 'active');
  assert.equal(listing.marketplaceQuantity, 4);
  assert.equal(listing.marketplaceSyncedAt, undefined);
  assert.equal(listing.channelAccountId, undefined);
  assert.equal(listing.externalProductId, undefined);
  assert.equal(listing.images, undefined);
  assert.deepEqual(listing.metadata, {
    effectivePrice: 19.9,
    price: 24,
    regularPrice: 24,
    offerPrice: 19.9,
    offerIsActive: true,
    sellerWarehouseQuantity: 2,
    fulfillmentQuantity: 2,
    stockSource: 'falabella_get_stock',
    isSellable: true,
    sellabilityReason: null,
    contentScore: 88,
    isPublished: true,
    status: 'active',
    marketplaceStatus: 'active',
    qcStatus: 'approved',
    url: 'https://www.falabella.com.pe/falabella-pe/product/123',
  });
  assert.equal(Object.hasOwn(listing.metadata, 'images'), false);
  assert.equal(Object.hasOwn(listing.metadata, 'marketplaceSyncedAt'), false);
});

test('el catálogo resume grupos y aplica filtros especiales desde SQL', async () => {
  const statements = [];
  const db = {
    query: async (sql, params) => {
      statements.push({ sql, params });
      if (sql.includes('as out_of_stock')) {
        return {
          rows: [{
            total: 12,
            active: 10,
            inactive: 2,
            archived: 1,
            single_seller: 6,
            multiple_sellers: 3,
            out_of_stock: 2,
            unpublished: 1,
            low_stock: 4,
            without_sales: 55,
            units_available: 447,
            units_to_reorder: 1845,
            inventory_value: 26365,
            units_sold_30: 2108,
            revenue_30: 92671,
          }],
        };
      }
      return { rows: [] };
    },
  };
  const listed = await listProducts({ status: 'active', special: 'outOfStock' }, db);
  assert.equal(listed.summary.active, 10);
  assert.equal(listed.summary.singleSeller, 6);
  assert.equal(listed.summary.outOfStock, 2);
  assert.equal(listed.summary.withoutSales, 55);
  assert.equal(listed.summary.unitsAvailable, 447);
  assert.equal(listed.summary.unitsToReorder, 1845);
  assert.equal(listed.summary.inventoryValue, 26365);
  assert.equal(listed.summary.unitsSold30, 2108);
  assert.equal(listed.summary.revenue30, 92671);
  assert.equal(listed.summary.daysOfSupply, 447 / (2108 / 30));
  const summarySql = statements.find((statement) => statement.sql.includes('as out_of_stock'))?.sql || '';
  assert.match(summarySql, /as with_stock/);
  assert.match(summarySql, /as without_stock/);
  assert.match(summarySql, /as units_available/);
  assert.match(summarySql, /as units_sold_30/);
  assert.match(summarySql, /as without_sales/);
  assert.match(summarySql, /as revenue_30/);
  assert.match(summarySql, /sales30 as/);
  assert.match(summarySql, /coalesce\(oi\.product_id, linked\.product_id, listing\.product_id\)/);
  assert.match(summarySql, /coalesce\(i\.reorder_point, sales30\.sold, 0\)/);
  assert.match(summarySql, /coalesce\(coverage\.listing_price, p\.reference_price, 0\)/);
  const outOfStockSql = statements.find((statement) => statement.sql.includes('count(*) over()'))?.sql || '';
  assert.match(outOfStockSql, /marketplace_quantity[\s\S]*= 0/);
  assert.match(outOfStockSql, /exists[\s\S]*publication_listing[\s\S]*metadata->>'isPublished'/);
  statements.length = 0;
  await listProducts({ special: 'unpublished', status: 'active' }, db);
  const unpublishedSql = statements.find((statement) => statement.sql.includes('count(*) over()'))?.sql || '';
  assert.match(unpublishedSql, /not exists[\s\S]*publication_listing[\s\S]*metadata->>'isPublished'/);
  statements.length = 0;
  await listProducts({ lowStock: true, status: 'active' }, db);
  const lowStockSql = statements.find((statement) => statement.sql.includes('count(*) over()'))?.sql || '';
  assert.match(lowStockSql, /reorder_point is not null/);
  await assert.rejects(() => listProducts({ special: 'unknown' }, db), /special inválido/);
});

test('el resumen de catálogo expone kpis operativos desde SQL', async () => {
  const statements = [];
  const db = {
    query: async (sql, params) => {
      statements.push({ sql, params });
      return {
        rows: [{
          scoped_total: 135,
          without_sales: 55,
          out_of_stock: 13,
          units_to_reorder: 1827,
          units_sold_30: 2090,
        }],
      };
    },
  };
  const summary = await getCatalogSummary({ status: 'active' }, db);
  assert.equal(summary.scopedTotal, 135);
  assert.equal(summary.withoutSales, 55);
  assert.equal(summary.outOfStock, 13);
  assert.equal(summary.unitsToReorder, 1827);
  assert.equal(summary.unitsSold30, 2090);
  assert.match(statements[0].sql, /as without_sales/);
  assert.match(statements[0].sql, /as units_sold_30/);
  assert.equal(statements[0].params.length, 1);
  assert.equal(statements[0].params[0], 'active');
});

test('las salidas del día agregan pedidos locales por producto y fecha de Lima', async () => {
  const statements = [];
  const db = {
    query: async (sql, params) => {
      statements.push({ sql, params });
      if (sql.includes('seller_rows as')) {
        return {
          rows: [{
            product_key: 'p:5',
            product_id: 5,
            sku: 'AG3',
            name: 'Agua 3L',
            image_url: null,
            shop_sku: '12345678',
            brand: null,
            quantity_on_hand: 12,
            available: 10,
            units_sold: 4,
            orders_count: 3,
            sellers_count: 1,
            revenue: 40,
            sellers: [{ companyId: 8, companyName: 'LIMBO', unitsSold: 4, ordersCount: 3 }],
          }],
        };
      }
      return {
        rows: [{
          products_count: 1,
          units_sold: 4,
          orders_count: 3,
          sellers_count: 1,
          sellers: [{ companyId: 8, companyName: 'LIMBO', unitsSold: 4, ordersCount: 3, productsCount: 1 }],
        }],
      };
    },
  };
  const result = await listTodayProductSales({ date: '2026-08-12', search: 'AG3', companyId: 8 }, db);
  assert.equal(result.date, '2026-08-12');
  assert.equal(result.timezone, 'America/Lima');
  assert.equal(result.products[0].unitsSold, 4);
  assert.equal(result.products[0].mapped, true);
  assert.equal(result.totals.ordersCount, 3);
  assert.equal(result.totals.sellersCount, 1);
  assert.equal(result.totals.sellers[0].companyName, 'LIMBO');
  assert.match(statements[1].sql, /count\(distinct company_id\)/);
  assert.match(statements[0].sql, /timezone\('America\/Lima', \$1::date\)/);
  assert.match(statements[0].sql, /promised_shipping_at/);
  assert.match(statements[0].sql, /PromisedShippingTime/);
  assert.doesNotMatch(statements[0].sql, /falabella_created_at/);
  assert.match(statements[0].sql, /o\.company_id=\$2/);
  assert.match(statements[0].sql, /left join product_listings linked on linked\.id=oi\.listing_id/);
  assert.match(statements[0].sql, /metadata->'images'->>0/);
  assert.match(statements[0].sql, /media\.falabella\.com/);
  assert.match(statements[0].sql, /left join lateral/);
  assert.match(statements[0].sql, /lower\(l\.title\)=lower\(oi\.description\)/);
  assert.match(statements[0].sql, /coalesce\(oi\.product_id, linked\.product_id, listing\.product_id\)/);
  assert.match(statements[0].sql, /order by sum\(units_sold\) desc nulls last/);
  assert.equal(statements[0].params[0], '2026-08-12');
  const named = await listTodayProductSales({ date: '2026-08-12', sortBy: 'product', sortDir: 'asc' }, db);
  assert.equal(named.products[0].sku, 'AG3');
  assert.match(statements[3].sql, /order by min\(name\) asc nulls last/);
  await assert.rejects(() => listTodayProductSales({ date: 'no-es-fecha' }, db), /date inválida/);
});

test('la hidratación de ventas solo pide a Falabella la ventana de 2 días', async () => {
  const requested = [];
  const db = {
    query: async (sql, params = []) => {
      const compact = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (compact.startsWith('update order_items set')) return { rows: [] };
      if (compact.includes('from product_listings') && compact.includes('distinct company_id')) {
        return { rows: [{ company_id: 8 }] };
      }
      if (compact.includes('from falabella_sync_state')) {
        return { rows: [{ company_id: 8, cursor_updated_at: '2026-08-11T12:00:00.000Z', sellers: 1, successful_sellers: 1, data_updated_through: '2026-08-11T12:00:00.000Z', last_successful_sync_at: '2026-08-11T12:00:00.000Z' }] };
      }
      if (compact.includes('from falabella_orders fo') && compact.includes('not exists')) {
        assert.equal(params[1], LIVE_WINDOW_DAYS);
        return { rows: [] };
      }
      if (compact.includes('from falabella_orders fo')) {
        return { rows: [{ order_headers: 2, order_details: 2 }] };
      }
      return { rows: [] };
    },
  };
  const result = await hydrateProductActivity(5, { range: '365', kind: 'sales' }, db, {
    core: { getCompany: async () => ({ id: 8, falabellaApiUserId: 'user', falabellaApiKey: 'key' }) },
    orderClientFactory: () => ({
      getOrdersV2: async (query) => {
        requested.push(query);
        return { ok: true, status: 200, data: { orders: [] } };
      },
    }),
  });
  assert.equal(requested.length, 1);
  const windowStart = Date.parse(requested[0].updatedAfter || requested[0].createdAfter);
  assert.equal(Number.isNaN(windowStart), false);
  assert.ok(Date.now() - windowStart <= (LIVE_WINDOW_DAYS * 86_400_000) + (10 * 60_000) + 5_000);
  assert.equal(result.live.windowDays, 2);
});

test('Salidas hidrata pedidos del plazo de envío, no solo los creados hace 2 días', async () => {
  const statements = [];
  const db = {
    query: async (sql, params = []) => {
      statements.push({ sql, params });
      const compact = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (compact.startsWith('select id from companies')) return { rows: [{ id: 8 }] };
      if (compact.includes('from falabella_sync_state')) {
        return { rows: [{ company_id: 8, cursor_updated_at: '2026-08-11T12:00:00.000Z', sellers: 1, successful_sellers: 1 }] };
      }
      if (compact.includes('not exists')) {
        assert.match(sql, /PromisedShippingTime/);
        assert.equal(params[1], '2026-08-12');
        assert.equal(sql.includes("falabella_created_at >= now() - ($2 * interval '1 day')"), false);
        return { rows: [] };
      }
      if (compact.includes('from falabella_orders fo')) return { rows: [{ order_headers: 76, order_details: 0 }] };
      return { rows: [] };
    },
  };
  const result = await hydrateRecentSalesActivity({ date: '2026-08-12' }, db, {
    core: { getCompany: async () => ({ id: 8, falabellaApiUserId: 'user', falabellaApiKey: 'key' }) },
    orderClientFactory: () => ({
      getOrdersV2: async () => ({ ok: true, status: 200, data: { orders: [] } }),
    }),
  });
  assert.equal(result.candidates, 0);
  assert.equal(statements.some(({ sql }) => sql.includes('PromisedShippingTime')), true);
});

test('import con SKU sanitizado colisionado reutiliza el producto y crea el listing', async () => {
  const queries = [];
  const db = {
    async query(sql, params = []) {
      const compact = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      queries.push({ sql: compact, params });
      if (compact.startsWith('select p.id, p.main_sku from product_listings')) return { rows: [] };
      if (compact.startsWith('select id, main_sku from products')) return { rows: [{ id: 9, main_sku: 'CAMISETA-NEGRA-M' }] };
      if (compact.startsWith('select exists(select 1 from products')) {
        return { rows: [{ product_exists: true, company_exists: true, account_exists: true }] };
      }
      if (compact.startsWith('insert into product_listings')) {
        return { rows: [{
          id: 30, product_id: params[0], channel_code: params[1], company_id: params[2],
          channel_account_id: null, seller_sku: params[4], shop_sku: params[5], status: 'active',
          marketplace_quantity: params[8], metadata: JSON.parse(params[10]),
        }] };
      }
      if (compact.startsWith('with listing_totals as')) return { rows: [] };
      if (compact.startsWith('with desired_product_statuses as')) return { rows: [] };
      throw new Error(`Query no simulada: ${compact}`);
    },
  };
  const result = await importFalabellaCatalog({
    companyId: 1,
    mode: 'create_products_from_seller_sku',
    products: [{
      sellerSku: 'Camiséta negra / M',
      shopSku: 'SHOP-9',
      name: 'Camiseta',
      quantity: 4,
      status: 'active',
      qcStatus: 'approved',
      businessUnits: [{ operatorCode: 'fape', status: 'active', isPublished: '1' }],
    }],
  }, 'actor', db);
  assert.equal(result.productsCreated, 0);
  assert.equal(result.productsReused, 1);
  assert.equal(result.listingsUpserted, 1);
  assert.equal(queries.some(({ sql }) => sql.startsWith('insert into products')), false);
  const listingInsert = queries.find(({ sql }) => sql.startsWith('insert into product_listings'));
  assert.equal(listingInsert.params[0], 9);
  const metadata = JSON.parse(listingInsert.params[10]);
  assert.equal(metadata.isPublished, true);
  assert.equal(metadata.status, 'active');
  assert.equal(metadata.marketplaceStatus, 'active');
  assert.equal(queries.some(({ sql }) => sql.includes('product_inventory')), false);
  assert.equal(queries.some(({ sql }) => sql.startsWith('with desired_product_statuses as')), false);
});

test('import conserva el stock reportado de una publicación Falabella no autorizada', async () => {
  const queries = [];
  const db = {
    async query(sql, params = []) {
      const compact = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      queries.push({ sql: compact, params });
      if (compact.startsWith('select p.id, p.main_sku from product_listings')) return { rows: [{ id: 9, main_sku: 'AG76' }] };
      if (compact.startsWith('select exists(select 1 from products')) {
        return { rows: [{ product_exists: true, company_exists: true, account_exists: true }] };
      }
      if (compact.startsWith('insert into product_listings')) {
        return { rows: [{
          id: 31, product_id: params[0], channel_code: params[1], company_id: params[2],
          channel_account_id: null, seller_sku: params[4], shop_sku: params[5], status: 'active',
          marketplace_quantity: params[8], metadata: JSON.parse(params[10]),
        }] };
      }
      if (compact.startsWith('with listing_totals as')) return { rows: [] };
      if (compact.startsWith('with desired_product_statuses as')) return { rows: [] };
      throw new Error(`Query no simulada: ${compact}`);
    },
  };
  await importFalabellaCatalog({
    companyId: 2,
    mode: 'listings_only',
    products: [{
      sellerSku: 'PDG44345564', shopSku: '138999856', name: 'Pulsera para camara Gopro accesorio',
      quantity: 100, status: 'active', qcStatus: 'rejected',
      businessUnits: [{ operatorCode: 'fape', status: 'active', isPublished: '0', stock: '100' }],
    }],
  }, 'actor', db);
  const listingInsert = queries.find(({ sql }) => sql.startsWith('insert into product_listings'));
  const metadata = listingInsert.params[10] && JSON.parse(listingInsert.params[10]);
  assert.equal(listingInsert.params[8], 100);
  assert.equal(metadata.reportedAvailableQuantity, 100);
  assert.equal(metadata.isSellable, false);
  assert.equal(metadata.sellabilityReason, 'qc_not_approved');
  assert.equal(queries.some(({ sql }) => sql.includes('product_inventory')), false);
  assert.equal(queries.some(({ sql }) => sql.startsWith('with desired_product_statuses as')), false);
});

test('GetProducts se consulta por lotes de 100 SKU', async () => {
  const calls = [];
  const sellerSkus = Array.from({ length: 101 }, (_, index) => `SKU-${index}`);
  const products = await fetchFalabellaProductsBySku({
    falabellaGetProducts: async (input) => {
      calls.push(input);
      return { ok: true, products: input.filters.skuSellerList.map((sellerSku) => ({ sellerSku })) };
    },
  }, 2, [...sellerSkus, sellerSkus[0]]);

  assert.deepEqual(calls.map(({ filters }) => filters.skuSellerList.length), [100, 1]);
  assert.equal(products.length, 101);
});

test('refresh de publicaciones actualiza stock y precio sin crear productos ni cambiar el vínculo', async () => {
  const queries = [];
  const listing = {
    id: 40, product_id: 9, company_id: 2, seller_sku: 'LIMBO-1',
  };
  const db = {
    async query(sql, params = []) {
      const compact = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      queries.push({ sql: compact, params });
      if (compact.includes('from product_listings l') && compact.includes('join products p')) {
        return { rows: [listing] };
      }
      if (compact.startsWith('update product_listings set')) {
        return { rows: [] };
      }
      if (compact.startsWith('with listing_totals as')) return { rows: [] };
      if (compact.startsWith('with desired_product_statuses as')) return { rows: [] };
      throw new Error(`Query no simulada: ${compact}`);
    },
  };
  const result = await refreshFalabellaListingSnapshots({}, db, {
    core: {
      falabellaGetProducts: async () => ({
        ok: true,
        products: [{
          sellerSku: 'LIMBO-1',
          shopSku: 'SHOP-40',
          productId: 'EXT-40',
          name: 'Camiseta',
          status: 'active',
          qcStatus: 'approved',
          url: 'https://www.falabella.com.pe/falabella-pe/product/100/camiseta/101',
          businessUnits: [{
            operatorCode: 'fape', status: 'active', isPublished: '1', price: '39.9', stock: '17',
          }],
        }],
      }),
      falabellaGetStock: async () => ({
        ok: true,
        stocks: [{ sellerSku: 'LIMBO-1', availableQuantity: 17, sellerWarehouseQuantity: 17, fulfillmentQuantity: 0 }],
      }),
    },
    fetchPublicAvailabilities: async () => new Map([['LIMBO-1', {
      status: 'unavailable',
      isPublished: false,
      isOutOfStock: true,
      checkedAt: '2026-08-24T12:00:00.000Z',
    }]]),
  });

  assert.equal(result.requested, 1);
  assert.equal(result.refreshed, 1);
  assert.equal(queries.some(({ sql }) => sql.includes('insert into products')), false);
  assert.equal(queries.some(({ sql }) => sql.startsWith('insert into product_listings')), false);
  const listingUpdate = queries.find(({ sql }) => sql.startsWith('update product_listings set'));
  assert.equal(/(^|[\s,])product_id\s*=/.test(listingUpdate.sql), false);
  assert.equal(listingUpdate.params[0], 'SHOP-40');
  assert.equal(listingUpdate.params[3], 0);
  assert.equal(listingUpdate.params[5], 40);
  const metadata = JSON.parse(listingUpdate.params[4]);
  assert.equal(metadata.effectivePrice, 39.9);
  assert.equal(metadata.stockSource, 'falabella_get_stock');
  assert.equal(metadata.reportedAvailableQuantity, 17);
  assert.equal(metadata.publicAvailabilityStatus, 'unavailable');
  assert.equal(queries.some(({ sql }) => sql.includes('product_inventory')), false);
});

test('refresh Falabella pone en cero una publicación que ya no existe en el catálogo remoto', async () => {
  const updates = [];
  let stockCalls = 0;
  const db = {
    async query(sql, params = []) {
      const compact = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (compact.includes('from product_listings l') && compact.includes("l.channel_code='falabella'")) {
        return { rows: [{ id: 40, product_id: 9, company_id: 2, seller_sku: 'AUSENTE' }] };
      }
      if (compact.startsWith('update product_listings set')) {
        updates.push({ sql: compact, params });
        return { rows: [] };
      }
      throw new Error(`Query no simulada: ${compact}`);
    },
  };

  const result = await refreshFalabellaListingSnapshots({}, db, {
    core: {
      falabellaGetProducts: async () => ({ ok: true, products: [] }),
      falabellaGetStock: async () => {
        stockCalls += 1;
        return { ok: true, stocks: [] };
      },
    },
    fetchPublicAvailabilities: async () => new Map(),
  });

  assert.equal(result.refreshed, 1);
  assert.equal(result.missing.length, 1);
  assert.equal(stockCalls, 0);
  assert.match(updates[0].sql, /status='inactive'.*marketplace_quantity=0/);
  assert.equal(updates[0].params[1], 40);
  const metadata = JSON.parse(updates[0].params[0]);
  assert.equal(metadata.isPublished, false);
  assert.equal(metadata.sellabilityReason, 'not_returned_by_falabella_catalog');
});

test('refresh Ripley actualiza existentes y pone en cero una oferta ausente sin crear maestros', async () => {
  const updates = [];
  const db = {
    async query(sql, params = []) {
      const compact = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (compact.includes("where l.channel_code='ripley'")) {
        return { rows: [
          { id: 80, product_id: 9, company_id: 2, seller_sku: 'R-ACTIVO' },
          { id: 81, product_id: 10, company_id: 2, seller_sku: 'R-AUSENTE' },
        ] };
      }
      if (compact.startsWith('update product_listings set')) {
        updates.push({ sql: compact, params });
        return { rows: [] };
      }
      throw new Error(`Query no simulada: ${compact}`);
    },
  };

  const result = await refreshRipleyListingSnapshots({}, db, {
    core: {},
    async listRipleyProducts() {
      return { offers: [{
        sellerSku: 'R-ACTIVO', productSku: 'P-1', productTitle: 'Mochila',
        active: true, quantity: 7, price: 29.9, imageUrl: 'https://cdn.example/r.jpg',
      }] };
    },
  });

  assert.equal(result.refreshed, 2);
  assert.equal(result.missing.length, 1);
  assert.deepEqual(updates.map(({ params }) => ({ status: params[3], stock: params[4], id: params[6] })), [
    { status: 'active', stock: 7, id: 80 },
    { status: 'inactive', stock: 0, id: 81 },
  ]);
  assert.equal(updates.some(({ sql }) => sql.includes('insert into products')), false);
});
