import test from 'node:test';
import assert from 'node:assert/strict';
import { applyInventoryMovement, InsufficientStockError } from './catalog/inventory-service.js';
import { resolveListing } from './catalog/sku-resolver.js';
import { stockPhase } from './catalog/stock-phase.js';
import {
  falabellaCanonicalIdentity,
  importFalabellaCatalog,
  isFalabellaActivePublished,
  sanitizeMainSku,
} from './catalog/catalog-import.js';
import { falabellaPublicationSnapshot } from './catalog/listing-snapshot-service.js';
import { listProducts, listTodayProductSales } from './catalog/product-service.js';
import { hydrateProductActivity, hydrateRecentSalesActivity, LIVE_WINDOW_DAYS } from './catalog/catalog-sales.js';
import {
  falabellaAssociationProfile,
  groupFalabellaCatalogRecords,
  scoreFalabellaAssociation,
} from './catalog/catalog-association.js';

class InventoryDb {
  constructor(quantity = 10) {
    this.quantity = quantity;
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
    if (compact.startsWith('select quantity_on_hand, quantity_reserved from product_inventory')) {
      return { rows: [{ quantity_on_hand: this.quantity, quantity_reserved: 0 }] };
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
    throw new Error(`Query no simulada: ${compact}`);
  }
}

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
  return {
    db,
    existing: null,
    persisted: { id: 20, company_id: 1, order_status: 'confirmed', fulfillment_status: 'pending' },
    account: { id: 3, channelCode: 'falabella', settings: {} },
    upsertedItems,
    doomedItems: [],
    source: 'sync',
    enabled: true,
    ...overrides,
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
      existing: { order_status: 'confirmed', fulfillment_status: 'pending' },
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
    existing: { order_status: 'confirmed', fulfillment_status: 'pending' },
  }));
  assert.equal(result.applied, 0);
  assert.equal(db.quantity, 10);
  assert.equal(db.movements.size, 0);
  assert.equal(db.items.get(101).stock_state, 'skipped_policy');
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
  assert.equal(db.quantity, 0);
  assert.equal(db.movements.size, 0);
  assert.equal(db.items.get(101).stock_state, 'skipped_insufficient');
  assert.equal(db.items.get(101).stock_applied_quantity, 0);
  assert.equal(db.items.get(101).stock_revision, 0);
});

test('cancelación y devolución revierten cantidades aplicadas una sola vez', async () => {
  const cancelledDb = new InventoryDb(8);
  const applied = item({ product_id: 5, listing_id: 71, main_sku: 'ZEN-CAMISETA-M', stock_state: 'applied', stock_applied_quantity: 2, stock_revision: 1 });
  cancelledDb.items.set(101, { ...applied });
  await stockPhase(phaseInput(cancelledDb, [], {
    existing: { order_status: 'confirmed', fulfillment_status: 'pending' },
    persisted: { id: 20, company_id: 1, order_status: 'cancelled', fulfillment_status: 'cancelled' },
  }));
  assert.equal(cancelledDb.quantity, 10);
  assert.equal(cancelledDb.movements.has('sale_reversal:order_item:101:rev:2'), true);

  const returnedDb = new InventoryDb(8);
  returnedDb.items.set(101, { ...applied });
  const returnedOrder = { id: 20, company_id: 1, order_status: 'completed', fulfillment_status: 'returned' };
  await stockPhase(phaseInput(returnedDb, [], {
    existing: { order_status: 'completed', fulfillment_status: 'delivered' },
    persisted: returnedOrder,
  }));
  await stockPhase(phaseInput(returnedDb, [], {
    existing: { order_status: 'completed', fulfillment_status: 'returned' },
    persisted: returnedOrder,
  }));
  assert.equal(returnedDb.quantity, 10);
  assert.deepEqual([...returnedDb.movements.keys()], ['return:order_item:101:rev:2']);
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
    existing: { order_status: 'confirmed', fulfillment_status: 'pending' },
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

test('la asociación no mezcla variantes ni familias ambiguas', () => {
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
    name: 'Camiseta Reductora Masculina para Moldear Abdomen y Pecho',
    color: 'Blanco',
    size: 'XL',
    price: 23.98,
  }).reason, 'ambiguous_product_family');
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
  ]);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map((group) => group.records.map(({ remote }) => remote.sellerSku).sort()).sort(), [
    ['A-M', 'A-Y'],
    ['G-D', 'G-L', 'G-Y'],
    ['R-L', 'R-Y'],
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

  statements.length = 0;
  await listProducts({ sellerCoverage: 'none', status: 'active' }, db);
  const noSellerSql = statements.find((statement) => statement.sql.includes('count(*) over()'))?.sql || '';
  assert.match(noSellerSql, /count\(distinct coverage_listing\.company_id\)[\s\S]*= 0/);
  await assert.rejects(() => listProducts({ sellerCoverage: 'unknown' }, db), /sellerCoverage inválido/);
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
  assert.match(filtered.sql, /quantity_on_hand - i\.quantity_reserved\) <= 0/);
  assert.match(filtered.sql, /not exists[\s\S]*publication_listing\.company_id=any\(\$1::int\[\]\)[\s\S]*metadata->>'isPublished'[\s\S]*metadata->>'status'[\s\S]*metadata->>'marketplaceStatus'[\s\S]*metadata->>'qcStatus'/);
  assert.match(filtered.sql, /order by listing_stats\.sellers_count asc nulls last, p\.id desc/);
  const allStatusSummary = statements.find((statement) => statement.sql.includes('as single_seller'))?.sql || '';
  assert.match(allStatusSummary, /count\(\*\) filter \(where true\) as total/);

  statements.length = 0;
  await listProducts({ inventoryStatus: 'lowStock', publicationStatus: 'published' }, db);
  const lowStock = statements.find((statement) => statement.sql.includes('count(*) over()'))?.sql || '';
  assert.match(lowStock, /quantity_on_hand - i\.quantity_reserved\) > 0[\s\S]*reorder_point is not null/);
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
  assert.match(sortedByAvailable, /order by \(i\.quantity_on_hand - i\.quantity_reserved\) asc nulls last, p\.id desc/);

  await assert.rejects(() => listProducts({ inventoryStatus: 'unknown' }, db), /inventoryStatus inválido/);
  await assert.rejects(() => listProducts({ publicationStatus: 'unknown' }, db), /publicationStatus inválido/);
  await assert.rejects(() => listProducts({ sortBy: 'unknown' }, db), /sortBy inválido/);
  await assert.rejects(() => listProducts({ sortDir: 'sideways' }, db), /sortDir inválido/);
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
  const outOfStockSql = statements.find((statement) => statement.sql.includes('count(*) over()'))?.sql || '';
  assert.match(outOfStockSql, /marketplace_quantity[\s\S]*= 0/);
  assert.match(outOfStockSql, /count\(distinct coverage_listing\.company_id\)[\s\S]*> 0/);
  statements.length = 0;
  await listProducts({ special: 'unpublished', status: 'active' }, db);
  const unpublishedSql = statements.find((statement) => statement.sql.includes('count(*) over()'))?.sql || '';
  assert.match(unpublishedSql, /count\(distinct coverage_listing\.company_id\)[\s\S]*= 0/);
  statements.length = 0;
  await listProducts({ lowStock: true, status: 'active' }, db);
  const lowStockSql = statements.find((statement) => statement.sql.includes('count(*) over()'))?.sql || '';
  assert.match(lowStockSql, /reorder_point is not null/);
  await assert.rejects(() => listProducts({ special: 'unknown' }, db), /special inválido/);
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
});
