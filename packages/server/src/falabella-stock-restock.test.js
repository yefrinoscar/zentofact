import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestFalabellaOrder, mapFalabellaCanonicalStatus } from './order-adapters/falabella.js';
import { syncFalabellaOrders } from './falabella-sync.js';

function listing() {
  return {
    listing_id: 71,
    product_id: 5,
    channel_code: 'falabella',
    company_id: 7,
    seller_sku: 'FA-123',
    shop_sku: 'SHOP-1',
    main_sku: 'ZEN-CAMISETA-M',
    product_name: 'Camiseta M',
    product_status: 'active',
    quantity_on_hand: 10,
    status: 'active',
  };
}

function accountRow() {
  return {
    id: 70,
    company_id: 7,
    channel_id: 1,
    external_account_id: 'default',
    display_name: 'Falabella',
    auto_create_orders: true,
    document_requirement: 'optional',
    document_type_policy: 'automatic',
    credential_reference: null,
    settings: {},
    active: true,
    channel_code: 'falabella',
    channel_name: 'Falabella',
  };
}

class RestockDb {
  constructor(quantity = 10) {
    this.quantity = quantity;
    this.movements = new Map();
    this.orders = new Map();
    this.items = new Map();
    this.itemsByKey = new Map();
    this.listings = [listing()];
    this.account = accountRow();
    this.falabellaOrders = [];
    this.nextOrderId = 20;
    this.nextItemId = 101;
    this.nextMovementId = 1;
    this.locked = true;
    this.queries = [];
    this.state = {
      company_id: 7,
      enabled: true,
      status: 'success',
      full_sync_completed: true,
      cursor_updated_at: '2026-08-18T10:00:00Z',
      last_successful_sync_at: '2026-08-18T10:00:00Z',
      sync_interval_minutes: 10,
    };
    this.released = false;
  }

  compact(sql) {
    return String(sql || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  async query(sql, params = []) {
    const compact = this.compact(sql);
    this.queries.push({ sql: compact, params });
    if (compact.startsWith('select pg_try_advisory_lock')) return { rows: [{ locked: this.locked }] };
    if (compact.startsWith('select pg_advisory_unlock')) return { rows: [] };
    if (compact.startsWith('select * from falabella_sync_state')) return { rows: [this.state] };
    if (compact.startsWith('insert into falabella_sync_state')) return { rows: [] };
    if (compact.startsWith('insert into falabella_sync_runs')) return { rows: [{ id: 55 }] };
    if (compact.startsWith('update falabella_sync_runs')) return { rows: [] };
    if (compact.startsWith('update falabella_sync_state')) return { rows: [] };
    if (compact.startsWith('select company_id, enabled, status')) return { rows: [this.state] };
    if (compact.startsWith('insert into falabella_order_lifecycle')) return { rows: [] };
    if (compact.startsWith('insert into falabella_orders')) {
      const status = params[5];
      this.falabellaOrders = [{
        order_id: params[1],
        order_number: params[2],
        status,
        falabella_created_at: params[3],
        falabella_updated_at: params[4],
        raw_data: JSON.parse(params[9] || '{}'),
        label_count: 1,
      }];
      return { rows: [{ status }] };
    }
    if (compact.includes('from falabella_orders') && compact.includes('pending|ready_to_ship')) {
      return { rows: this.falabellaOrders.filter((order) => /pending|ready_to_ship/i.test(order.status)) };
    }
    if (compact.includes('from falabella_orders fo') && compact.includes('not exists')) {
      return { rows: [] };
    }
    if (compact.startsWith('update falabella_orders')) {
      const order = this.falabellaOrders.find((row) => String(row.order_id) === String(params[1]));
      if (order) order.status = params[2];
      return { rows: [] };
    }
    if (compact.startsWith('select id, code, name, default_auto_create_orders')) {
      return { rows: [{ id: 1, code: 'falabella', name: 'Falabella', default_auto_create_orders: true, active: true }] };
    }
    if (compact.startsWith('insert into order_channel_accounts')) return { rows: [this.account] };
    if (compact.startsWith('select a.*, ch.code as channel_code')) return { rows: [this.account] };
    if (compact.startsWith('select * from orders')) {
      const found = [...this.orders.values()].find((order) => (
        Number(order.channel_account_id) === Number(params[0])
        && String(order.external_order_id) === String(params[1])
      ));
      return { rows: found ? [{ ...found }] : [] };
    }
    if (compact.startsWith('insert into orders')) {
      const key = `${params[1]}:${params[2]}`;
      const existing = this.orders.get(key);
      const row = {
        id: existing?.id || this.nextOrderId++,
        company_id: params[0],
        channel_account_id: params[1],
        external_order_id: params[2],
        external_order_number: params[3],
        order_status: params[4],
        payment_status: params[5],
        fulfillment_status: params[6],
        document_status: params[7],
        provider_status: params[8],
        document_requirement: params[9],
        document_type_policy: params[10],
        requested_document_type: params[11],
        currency: params[12],
        subtotal: params[13],
        shipping_amount: params[14],
        discount_amount: params[15],
        total: params[16],
        customer: JSON.parse(params[17]),
        shipping: JSON.parse(params[18]),
        metadata: JSON.parse(params[19]),
        ordered_at: params[20],
        promised_shipping_at: params[21],
        provider_updated_at: params[22],
        first_seen_at: '2026-08-18T15:00:00Z',
        last_seen_at: '2026-08-18T15:00:00Z',
        created_at: '2026-08-18T15:00:00Z',
        updated_at: '2026-08-18T15:00:00Z',
      };
      this.orders.set(key, row);
      return { rows: [{ ...row }] };
    }
    if (compact.startsWith('insert into order_snapshots')) return { rows: [{ id: 1 }] };
    if (compact.startsWith('insert into order_events')) return { rows: [{ id: 1 }] };
    if (compact.startsWith('select 1 from order_events')) return { rows: [] };
    if (compact.startsWith('insert into order_items')) {
      const orderId = Number(params[0]);
      const externalItemId = params[1];
      const key = `${orderId}:${externalItemId}`;
      const existingId = this.itemsByKey.get(key);
      const id = existingId || this.nextItemId++;
      const previous = this.items.get(id) || {};
      const row = {
        ...previous,
        id,
        order_id: orderId,
        external_item_id: externalItemId,
        sku: params[2],
        provider_sku: params[3],
        description: params[4],
        quantity: params[5],
        unit_price: params[6],
        discount_amount: params[7],
        tax_amount: params[8],
        total: params[9],
        provider_status: params[10],
        product_id: previous.product_id ?? null,
        listing_id: previous.listing_id ?? null,
        main_sku: previous.main_sku ?? null,
        stock_state: previous.stock_state || 'none',
        stock_applied_quantity: previous.stock_applied_quantity || 0,
        stock_revision: previous.stock_revision || 0,
      };
      this.items.set(id, row);
      this.itemsByKey.set(key, id);
      return { rows: [{ ...row }] };
    }
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
        id: this.nextMovementId++,
        product_id: params[0],
        movement_type: params[1],
        quantity_delta: params[2],
        quantity_after: params[3],
        reason: params[4],
        actor_user_id: params[5],
        source: params[6],
        order_id: params[7],
        order_item_id: params[8],
        listing_id: params[9],
        idempotency_key: key,
        metadata: JSON.parse(params[11]),
        created_at: new Date().toISOString(),
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
      const matches = this.listings.filter((row) => (
        row.channel_code === params[0] && row.company_id === params[1]
        && row.seller_sku === params[2] && row.status === 'active'
      ));
      return { rows: matches.slice(0, 1) };
    }
    if (compact.startsWith('update order_items set product_id') && compact.includes('stock_applied_quantity')) {
      const item = this.items.get(Number(params[6]));
      Object.assign(item, {
        product_id: params[0], listing_id: params[1], main_sku: params[2], stock_state: params[3],
        stock_applied_quantity: Number(params[4]), stock_revision: Number(params[5]),
      });
      return { rows: [] };
    }
    if (compact.startsWith('update order_items set product_id')) {
      const item = this.items.get(Number(params[4]));
      Object.assign(item, { product_id: params[0], listing_id: params[1], main_sku: params[2], stock_state: params[3] });
      return { rows: [] };
    }
    if (compact.includes('from order_items where order_id=$1') && compact.includes('stock_applied_quantity > 0')) {
      return { rows: [...this.items.values()].filter((item) => Number(item.order_id) === Number(params[0]) && item.stock_applied_quantity > 0) };
    }
    if (compact.includes('from order_items') && compact.includes('not (external_item_id')) {
      const seen = params[1] || [];
      return {
        rows: [...this.items.values()].filter((item) => (
          Number(item.order_id) === Number(params[0]) && !seen.includes(item.external_item_id)
        )),
      };
    }
    if (compact.includes('from order_items where order_id=$1 for update')) {
      return { rows: [...this.items.values()].filter((item) => Number(item.order_id) === Number(params[0])) };
    }
    if (compact.startsWith('delete from order_items')) return { rows: [] };
    throw new Error(`Query no simulada: ${compact}`);
  }

  release() {
    this.released = true;
  }
}

function falabellaOrder({ status, items, updatedAt = '2026-08-18T16:00:00Z' }) {
  return {
    OrderId: '99',
    OrderNumber: '3248709095',
    CreatedAt: '2026-08-18T15:00:00Z',
    UpdatedAt: updatedAt,
    GrandTotal: '129.90',
    Statuses: [{ Status: status }],
    OrderItems: items ? { OrderItem: items } : undefined,
  };
}

function orderItem({ status = 'ready_to_ship', quantity = 2 } = {}) {
  return {
    OrderItemId: 'EXT-1',
    SellerSku: 'FA-123',
    ShopSku: 'SHOP-1',
    Name: 'Camiseta M',
    Quantity: quantity,
    PaidPrice: '129.90',
    Status: status,
  };
}

test('mapea una devolución Falabella como pedido completado devuelto', () => {
  assert.deepEqual(mapFalabellaCanonicalStatus('returned'), {
    orderStatus: 'completed',
    fulfillmentStatus: 'returned',
  });
  assert.deepEqual(mapFalabellaCanonicalStatus('canceled'), {
    orderStatus: 'cancelled',
    fulfillmentStatus: 'cancelled',
  });
});

test('cancelar un pedido ya listo para enviar reintegra el stock con motivo de cancelación', async () => {
  const db = new RestockDb(10);
  const account = accountRow();
  await ingestFalabellaOrder({
    companyId: 7,
    account,
    source: 'sync',
    catalogInventoryEnabled: true,
    normalized: {
      orderId: '99',
      orderNumber: '3248709095',
      status: 'ready_to_ship',
      falabellaCreatedAt: '2026-08-18T15:00:00Z',
      falabellaUpdatedAt: '2026-08-18T15:10:00Z',
      grandTotal: 129.9,
      currency: 'PEN',
      raw: falabellaOrder({ status: 'ready_to_ship', items: [orderItem()] }),
    },
  }, db);
  assert.equal(db.quantity, 8);

  await ingestFalabellaOrder({
    companyId: 7,
    account,
    source: 'sync',
    catalogInventoryEnabled: true,
    normalized: {
      orderId: '99',
      orderNumber: '3248709095',
      status: 'canceled',
      falabellaCreatedAt: '2026-08-18T15:00:00Z',
      falabellaUpdatedAt: '2026-08-18T16:00:00Z',
      grandTotal: 129.9,
      currency: 'PEN',
      raw: falabellaOrder({ status: 'canceled', updatedAt: '2026-08-18T16:00:00Z' }),
    },
  }, db);

  assert.equal(db.quantity, 10);
  const movement = [...db.movements.values()].find((row) => row.movement_type === 'sale_reversal');
  assert.equal(movement.quantity_delta, 2);
  assert.equal(movement.reason, 'Cancelación del pedido 3248709095');
  assert.equal([...db.items.values()][0].stock_state, 'reversed');
});

test('devolver un pedido ya listo para enviar reintegra el stock con motivo de devolución', async () => {
  const db = new RestockDb(10);
  const account = accountRow();
  await ingestFalabellaOrder({
    companyId: 7,
    account,
    source: 'sync',
    catalogInventoryEnabled: true,
    normalized: {
      orderId: '99',
      orderNumber: '3248709095',
      status: 'ready_to_ship',
      falabellaCreatedAt: '2026-08-18T15:00:00Z',
      falabellaUpdatedAt: '2026-08-18T15:10:00Z',
      grandTotal: 129.9,
      currency: 'PEN',
      raw: falabellaOrder({ status: 'ready_to_ship', items: [orderItem()] }),
    },
  }, db);
  assert.equal(db.quantity, 8);

  await ingestFalabellaOrder({
    companyId: 7,
    account,
    source: 'sync',
    catalogInventoryEnabled: true,
    normalized: {
      orderId: '99',
      orderNumber: '3248709095',
      status: 'returned',
      falabellaCreatedAt: '2026-08-18T15:00:00Z',
      falabellaUpdatedAt: '2026-08-18T18:00:00Z',
      grandTotal: 129.9,
      currency: 'PEN',
      raw: falabellaOrder({ status: 'returned', updatedAt: '2026-08-18T18:00:00Z' }),
    },
  }, db);

  assert.equal(db.quantity, 10);
  const movement = [...db.movements.values()].find((row) => row.movement_type === 'return');
  assert.equal(movement.quantity_delta, 2);
  assert.equal(movement.reason, 'Devolución del pedido 3248709095');
});

async function ingestReadyToShip(db, { quantity = 1, catalogInventoryEnabled = true } = {}) {
  const account = accountRow();
  await ingestFalabellaOrder({
    companyId: 7,
    account,
    source: 'sync',
    catalogInventoryEnabled,
    normalized: {
      orderId: '99',
      orderNumber: '3248709095',
      status: 'ready_to_ship',
      falabellaCreatedAt: '2026-08-18T15:00:00Z',
      falabellaUpdatedAt: '2026-08-18T15:10:00Z',
      grandTotal: 129.9,
      currency: 'PEN',
      raw: falabellaOrder({
        status: 'ready_to_ship',
        items: [orderItem({ quantity })],
      }),
    },
  }, db);
  return account;
}

test('el sync de GetOrders reintegra una unidad al cancelar sin volver a pedir el flag de inventario', async () => {
  const db = new RestockDb(5);
  await ingestReadyToShip(db, { quantity: 1 });
  assert.equal(db.quantity, 4);

  const client = {
    async getOrdersV2() {
      return {
        ok: true,
        status: 200,
        data: { orders: [falabellaOrder({ status: 'canceled', updatedAt: '2026-08-18T16:00:00Z' })] },
      };
    },
    async call() {
      return { ok: true, status: 200, data: { SuccessResponse: { Body: { OrderItems: { OrderItem: [] } } } } };
    },
  };

  await syncFalabellaOrders(7, { now: '2026-08-18T16:00:00Z' }, {
    pool: { connect: async () => db },
    getCompany: async () => ({
      id: 7, activo: true, falabellaApiUserId: 'seller', falabellaApiKey: 'secret',
    }),
    clientFor: () => client,
    orderItemsClientFor: () => client,
  });

  assert.equal(db.quantity, 5);
  const movement = [...db.movements.values()].find((row) => row.movement_type === 'sale_reversal');
  assert.equal(movement.quantity_delta, 1);
  assert.equal(movement.reason, 'Cancelación del pedido 3248709095');
});

test('el sync de GetOrders reintegra una unidad al devolver un pedido ya enviado', async () => {
  const db = new RestockDb(5);
  const account = accountRow();
  await ingestFalabellaOrder({
    companyId: 7,
    account,
    source: 'sync',
    catalogInventoryEnabled: true,
    normalized: {
      orderId: '99',
      orderNumber: '3248709095',
      status: 'delivered',
      falabellaCreatedAt: '2026-08-18T15:00:00Z',
      falabellaUpdatedAt: '2026-08-18T17:00:00Z',
      grandTotal: 129.9,
      currency: 'PEN',
      raw: falabellaOrder({
        status: 'delivered',
        items: [orderItem({ quantity: 1, status: 'delivered' })],
        updatedAt: '2026-08-18T17:00:00Z',
      }),
    },
  }, db);
  assert.equal(db.quantity, 4);

  await ingestFalabellaOrder({
    companyId: 7,
    account,
    source: 'sync',
    normalized: {
      orderId: '99',
      orderNumber: '3248709095',
      status: 'returned',
      falabellaCreatedAt: '2026-08-18T15:00:00Z',
      falabellaUpdatedAt: '2026-08-18T20:00:00Z',
      grandTotal: 129.9,
      currency: 'PEN',
      raw: falabellaOrder({ status: 'returned', updatedAt: '2026-08-18T20:00:00Z' }),
    },
  }, db);

  assert.equal(db.quantity, 5);
  const movement = [...db.movements.values()].find((row) => row.movement_type === 'return');
  assert.equal(movement.quantity_delta, 1);
  assert.equal(movement.reason, 'Devolución del pedido 3248709095');
  await ingestFalabellaOrder({
    companyId: 7,
    account,
    source: 'sync',
    normalized: {
      orderId: '99',
      orderNumber: '3248709095',
      status: 'returned',
      falabellaCreatedAt: '2026-08-18T15:00:00Z',
      falabellaUpdatedAt: '2026-08-18T20:00:00Z',
      grandTotal: 129.9,
      currency: 'PEN',
      raw: falabellaOrder({ status: 'returned', updatedAt: '2026-08-18T20:00:00Z' }),
    },
  }, db);
  assert.equal(db.quantity, 5);
  assert.equal([...db.movements.values()].filter((row) => row.movement_type === 'return').length, 1);
});

test('el sync reintegra stock cuando GetOrderItems pasa un pedido listo para enviar a cancelado', async () => {
  const db = new RestockDb(10);
  const account = accountRow();
  await ingestFalabellaOrder({
    companyId: 7,
    account,
    source: 'sync',
    catalogInventoryEnabled: true,
    normalized: {
      orderId: '99',
      orderNumber: '3248709095',
      status: 'ready_to_ship',
      falabellaCreatedAt: '2026-08-18T15:00:00Z',
      falabellaUpdatedAt: '2026-08-18T15:10:00Z',
      grandTotal: 129.9,
      currency: 'PEN',
      raw: falabellaOrder({ status: 'ready_to_ship', items: [orderItem()] }),
    },
  }, db);
  db.falabellaOrders = [{
    order_id: '99',
    order_number: '3248709095',
    status: 'ready_to_ship',
    falabella_created_at: '2026-08-18T15:00:00Z',
    falabella_updated_at: '2026-08-18T15:10:00Z',
    raw_data: falabellaOrder({ status: 'ready_to_ship', items: [orderItem()] }),
    label_count: 1,
  }];

  const client = {
    async getOrdersV2() {
      return { ok: true, status: 200, data: { orders: [] } };
    },
    async call() {
      return {
        ok: true,
        status: 200,
        data: { SuccessResponse: { Body: { OrderItems: { OrderItem: [orderItem({ status: 'canceled' })] } } } },
      };
    },
  };

  await syncFalabellaOrders(7, { now: '2026-08-18T16:00:00Z' }, {
    pool: { connect: async () => db },
    getCompany: async () => ({
      id: 7,
      activo: true,
      falabellaApiUserId: 'seller',
      falabellaApiKey: 'secret',
    }),
    clientFor: () => client,
    orderItemsClientFor: () => client,
  });

  assert.equal(db.quantity, 10);
  const movement = [...db.movements.values()].find((row) => row.movement_type === 'sale_reversal');
  assert.equal(movement.reason, 'Cancelación del pedido 3248709095');
  assert.equal(db.released, true);
});
