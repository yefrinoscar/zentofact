import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimatedCommission,
  fillDailySales,
  getSalesPulse,
  getSalespersonHome,
  ingestOrder,
  listCanceledOrders,
  listOrders,
  resolveDocumentDecision,
  updateOrderPayment,
} from './order-management.js';
import { mapFalabellaCanonicalStatus, mapFalabellaOrderItems, mapFalabellaShipping, falabellaOrderShippingAmount } from './order-adapters/falabella.js';

function account(overrides = {}) {
  return {
    id: 22,
    company_id: 7,
    channel_id: 3,
    external_account_id: 'web',
    display_name: 'Tienda web',
    auto_create_orders: true,
    document_requirement: 'required',
    document_type_policy: 'customer_choice',
    credential_reference: null,
    settings: {},
    active: true,
    channel_code: 'external',
    channel_name: 'Pedido externo',
    ...overrides,
  };
}

class IngestDb {
  constructor(accountRow = account()) {
    this.account = accountRow;
    this.queries = [];
    this.inventory = new Map();
    this.movements = new Map();
  }

  async query(sql, params = []) {
    const compact = sql.replace(/\s+/g, ' ').trim();
    this.queries.push({ sql: compact, params });
    if (compact.startsWith('select a.*, ch.code as channel_code')) return { rows: [this.account] };
    if (compact.startsWith('select * from orders')) return { rows: [] };
    if (compact.startsWith('insert into product_inventory')) return { rows: [] };
    if (compact.startsWith('select quantity_on_hand, quantity_reserved')) {
      const onHand = this.inventory.get(Number(params[0])) ?? 100;
      return { rows: [{
        quantity_on_hand: onHand,
        quantity_reserved: this.reserved || 0,
        quantity_pending_return: this.pendingReturn || 0,
      }] };
    }
    if (compact.startsWith('update product_inventory set quantity_on_hand')) {
      this.inventory.set(Number(params[1]), Number(params[0]));
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
      if (this.approvals?.has?.(itemId)) return { rows: [] };
      this.approvals = this.approvals || new Map();
      this.approvals.set(itemId, { id: this.approvals.size + 1 });
      return { rows: [{ id: this.approvals.get(itemId).id }] };
    }
    if (compact.startsWith('select * from inventory_movements where idempotency_key')) {
      const row = this.movements.get(params[0]);
      return { rows: row ? [row] : [] };
    }
    if (compact.startsWith('insert into inventory_movements')) {
      const row = {
        id: this.movements.size + 1,
        product_id: params[0],
        movement_type: params[1],
        quantity_delta: params[2],
        quantity_after: params[3],
        idempotency_key: params[10],
        metadata: JSON.parse(params[11]),
      };
      this.movements.set(params[10], row);
      return { rows: [row] };
    }
    if (compact.startsWith('update order_items set product_id')) return { rows: [] };
    if (compact.startsWith('insert into orders')) {
      return { rows: [{
        id: 91,
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
        items_status: params[23],
        items_error: params[24],
        created_by: params[25] ?? null,
        cancelled_at: params[4] === 'cancelled' || params[6] === 'cancelled' ? params[22] : null,
        returned_at: params[6] === 'returned' ? params[22] : null,
        first_seen_at: '2026-07-30T15:00:00Z',
        last_seen_at: '2026-07-30T15:00:00Z',
        created_at: '2026-07-30T15:00:00Z',
        updated_at: '2026-07-30T15:00:00Z',
      }] };
    }
    if (compact.startsWith('insert into order_snapshots')) return { rows: [{ id: 1 }] };
    if (compact.startsWith('insert into order_items')) {
      return { rows: [{
        id: 501,
        external_item_id: params[1],
        sku: params[2],
        provider_sku: params[3],
        quantity: params[5],
        provider_status: params[10],
        product_id: params[13],
        listing_id: null,
        main_sku: null,
        stock_state: 'none',
        stock_applied_quantity: 0,
        stock_revision: 0,
      }] };
    }
    return { rows: [] };
  }
}

test('resuelve la política de comprobante por cuenta de canal', () => {
  assert.deepEqual(resolveDocumentDecision({
    documentRequirement: 'disabled',
    documentTypePolicy: 'factura',
    requestedDocumentType: 'factura',
  }), {
    enabled: false,
    required: false,
    type: null,
    needsCustomerChoice: false,
  });
  assert.deepEqual(resolveDocumentDecision({
    documentRequirement: 'optional',
    documentTypePolicy: 'automatic',
  }), {
    enabled: true,
    required: false,
    type: 'boleta',
    needsCustomerChoice: false,
  });
  assert.deepEqual(resolveDocumentDecision({
    documentRequirement: 'required',
    documentTypePolicy: 'customer_choice',
  }), {
    enabled: true,
    required: true,
    type: null,
    needsCustomerChoice: true,
  });
});

test('ingresa un pedido externo con snapshot, evento, items y política histórica', async () => {
  const db = new IngestDb();
  const result = await ingestOrder({
    companyId: 7,
    channelAccountId: 22,
    externalOrderId: 'WEB-100',
    externalOrderNumber: 'WEB-100',
    orderStatus: 'confirmed',
    fulfillmentStatus: 'pending',
    requestedDocumentType: 'factura',
    total: 129.9,
    customer: { name: 'Cliente prueba' },
    items: [{
      externalItemId: 'LINE-1',
      sku: 'SKU-1',
      description: 'Producto',
      quantity: 1,
      unitPrice: 129.9,
      total: 129.9,
    }],
    itemsComplete: true,
    source: 'api',
    idempotencyKey: 'request-100',
    rawPayload: { id: 'WEB-100' },
  }, db);

  assert.equal(result.created, true);
  assert.equal(result.order.channelCode, 'external');
  assert.equal(result.order.documentRequirement, 'required');
  assert.equal(result.order.documentTypePolicy, 'customer_choice');
  assert.equal(result.order.documentStatus, 'pending');
  assert.equal(result.order.itemsStatus, 'complete');
  assert.equal(result.order.documentDecision.type, 'factura');
  const itemUpsert = db.queries.find((query) => query.sql.startsWith('insert into order_items'));
  assert.ok(itemUpsert);
  assert.equal(itemUpsert.sql.split(' values ')[0].includes('product_id'), true);
  assert.equal(itemUpsert.params[13], null);
  assert.match(itemUpsert.sql, /returning id, external_item_id.*stock_revision/);
  assert.equal(db.queries.some((query) => query.sql.startsWith('insert into order_snapshots')), true);
  const event = db.queries.find((query) => query.sql.startsWith('insert into order_events'));
  assert.equal(event.params[1], 'order.created');
  assert.equal(event.params[4], 'request-100');
});

test('al cancelar o devolver un pedido guarda la fecha del cambio una sola vez', async () => {
  const canceledDb = new IngestDb();
  const canceled = await ingestOrder({
    companyId: 7,
    channelAccountId: 22,
    externalOrderId: '3249111405',
    externalOrderNumber: '3249111405',
    orderStatus: 'cancelled',
    fulfillmentStatus: 'cancelled',
    providerUpdatedAt: '2026-08-21T15:40:00Z',
    total: 8.98,
    source: 'sync',
  }, canceledDb);
  const canceledInsert = canceledDb.queries.find((query) => query.sql.startsWith('insert into orders'));
  assert.match(canceledInsert.sql, /cancelled_at/);
  assert.match(canceledInsert.sql, /returned_at/);
  assert.match(canceledInsert.sql, /coalesce\(\s*orders.cancelled_at/);
  assert.equal(canceled.order.cancelledAt, '2026-08-21T15:40:00.000Z');
  assert.equal(canceled.order.returnedAt, null);

  const returnedDb = new IngestDb();
  const returned = await ingestOrder({
    companyId: 7,
    channelAccountId: 22,
    externalOrderId: '3249038634',
    externalOrderNumber: '3249038634',
    orderStatus: 'completed',
    fulfillmentStatus: 'returned',
    providerUpdatedAt: '2026-08-20T17:36:00Z',
    total: 71.84,
    source: 'sync',
  }, returnedDb);
  assert.equal(returned.order.returnedAt, '2026-08-20T17:36:00.000Z');
  assert.equal(returned.order.cancelledAt, null);
});

test('persiste una cabecera con items pendientes sin ejecutar efectos de stock', async () => {
  const db = new IngestDb();
  const result = await ingestOrder({
    companyId: 7,
    channelAccountId: 22,
    externalOrderId: 'WEB-PENDING',
    fulfillmentStatus: 'ready_to_ship',
    itemsError: 'El proveedor no devolvió las líneas.',
    source: 'sync',
    rawPayload: { id: 'WEB-PENDING' },
  }, db);
  assert.equal(result.order.itemsStatus, 'error');
  assert.equal(result.order.itemsError, 'El proveedor no devolvió las líneas.');
  assert.equal(db.queries.some((query) => query.sql.startsWith('insert into inventory_movements')), false);
});

test('una venta manual conserva el productId del catálogo para descontar stock', async () => {
  const db = new IngestDb(account({ channel_code: 'manual' }));
  await ingestOrder(manualSale({
    fulfillmentStatus: 'ready_to_ship',
    orderedAt: '2026-09-04T18:00:00.000Z',
    shipping: { type: 'recojo' },
    items: [{
      externalItemId: 'VTA-1-1',
      sku: 'ZEN-CAMISETA-M',
      description: 'Camiseta M',
      quantity: 2,
      unitPrice: 50,
      total: 100,
      metadata: { productId: 42 },
    }],
  }), db);
  const itemUpsert = db.queries.find((query) => query.sql.startsWith('insert into order_items'));
  assert.ok(itemUpsert);
  assert.equal(itemUpsert.params[13], 42);
  const movement = [...db.movements.values()][0];
  assert.ok(movement, 'la venta manual debe descontar inventario en el mismo ingest');
  assert.equal(movement.movement_type, 'sale');
  assert.equal(movement.quantity_delta, -2);
  assert.equal(movement.product_id, 42);
});

test('una venta manual sin companyId nace sin seller asociado', async () => {
  const db = new IngestDb(account({ channel_code: 'manual' }));
  const { companyId: _omitted, ...sale } = manualSale({
    fulfillmentStatus: 'ready_to_ship',
    orderedAt: '2026-09-04T18:00:00.000Z',
    shipping: { type: 'recojo' },
    items: [{
      externalItemId: 'VTA-1-1',
      sku: 'ZEN-CAMISETA-M',
      description: 'Camiseta M',
      quantity: 2,
      unitPrice: 50,
      total: 100,
      metadata: { productId: 42 },
    }],
  });
  const result = await ingestOrder(sale, db);
  assert.equal(result.order.companyId, null);
  const insert = db.queries.find((query) => query.sql.startsWith('insert into orders'));
  assert.ok(insert);
  assert.equal(insert.params[0], null);
  const movement = [...db.movements.values()][0];
  assert.ok(movement, 'la venta manual sin seller igual descuenta inventario');
  assert.equal(movement.movement_type, 'sale');
  assert.equal(movement.product_id, 42);
});

test('respeta el apagado de creación automática por cuenta', async () => {
  const db = new IngestDb(account({ auto_create_orders: false }));
  const result = await ingestOrder({
    companyId: 7,
    channelAccountId: 22,
    externalOrderId: 'AUTO-1',
    automatic: true,
  }, db);
  assert.deepEqual(result, {
    skipped: true,
    reason: 'auto_create_disabled',
    channelAccountId: 22,
  });
  assert.equal(db.queries.some((query) => query.sql.startsWith('insert into orders')), false);
});

test('mapea los estados de Falabella sin contaminar el modelo canónico', () => {
  assert.deepEqual(mapFalabellaCanonicalStatus('pending'), {
    orderStatus: 'confirmed',
    fulfillmentStatus: 'pending',
  });
  assert.deepEqual(mapFalabellaCanonicalStatus('ready_to_ship'), {
    orderStatus: 'confirmed',
    fulfillmentStatus: 'ready_to_ship',
  });
  assert.deepEqual(mapFalabellaCanonicalStatus('delivered'), {
    orderStatus: 'completed',
    fulfillmentStatus: 'delivered',
  });
  assert.deepEqual(mapFalabellaCanonicalStatus('cancelled'), {
    orderStatus: 'cancelled',
    fulfillmentStatus: 'cancelled',
  });
  assert.deepEqual(mapFalabellaCanonicalStatus('pending|canceled'), {
    orderStatus: 'cancelled',
    fulfillmentStatus: 'cancelled',
  });
});

test('arma la dirección oficial de Falabella desde AddressShipping', () => {
  assert.deepEqual(mapFalabellaShipping({
    ShippingType: 'Dropshipping',
    AddressShipping: {
      Address1: 'Prolongacion Chapén #1141',
      Address3: 'segundo piso',
      City: 'CAJAMARCA',
      Region: 'CAJAMARCA',
    },
  }), {
    type: 'Dropshipping',
    address: 'Prolongacion Chapén #1141, segundo piso, CAJAMARCA',
    city: 'CAJAMARCA',
    region: 'CAJAMARCA',
    trackingCode: '',
  });
});

test('cada OrderItem de Falabella cuenta como una unidad cuando Quantity no viene informado', () => {
  const items = mapFalabellaOrderItems({
    OrderItems: {
      OrderItem: [
        { OrderItemId: '1', SellerSku: 'SILLA-1', PaidPrice: '178.90' },
        { OrderItemId: '2', SellerSku: 'SILLA-1', PaidPrice: '178.90' },
      ],
    },
  });
  assert.deepEqual(items.map((item) => item.quantity), [1, 1]);
});

test('el envío de la orden es la suma de ShippingAmount de cada item', () => {
  const raw = {
    OrderItems: {
      OrderItem: [
        { OrderItemId: '1', PaidPrice: '98.89', ShippingAmount: '17.45' },
        { OrderItemId: '2', PaidPrice: '98.89', ShippingAmount: '17.45' },
      ],
    },
  };
  const items = mapFalabellaOrderItems(raw);
  assert.deepEqual(items.map((item) => item.shippingAmount), [17.45, 17.45]);
  assert.equal(falabellaOrderShippingAmount(raw, items), 34.9);
  assert.equal(falabellaOrderShippingAmount({ ShippingFee: '9.90' }), 9.9);
});

test('resume qué sellers vendieron hoy e incluye a quienes no tuvieron ventas', async () => {
  const db = {
    async query(sql, params) {
      assert.match(sql, /America\/Lima/);
      assert.deepEqual(params, ['2026-08-12']);
      if (sql.includes('left join orders')) return { rows: [
          {
            company_id: 8,
            nombre: 'LIMBO PERU S.R.L.',
            nombre_comercial: 'LIMBO',
            razon_social: 'LIMBO PERU S.R.L.',
            orders_count: 3,
            sales_total: '480.50',
            manual_orders_count: 2,
            last_sale_at: '2026-08-12T18:30:00.000Z',
          },
          {
            company_id: 9,
            nombre: 'INVERSIONES MANTA RAYA E.I.R.L.',
            nombre_comercial: 'MANTA RAYA EIRL',
            razon_social: 'INVERSIONES MANTA RAYA E.I.R.L.',
            orders_count: 0,
            sales_total: '0',
            manual_orders_count: 0,
            last_sale_at: null,
          },
        ] };
      if (sql.includes('join order_items')) return { rows: [{
        sku: 'SKU-1',
        product_name: 'Producto principal',
        image_url: 'https://img.example/p.jpg',
        shop_sku: '12345678',
        units_sold: '5',
        total_units_sold: '5',
        orders_count: 3,
        sales_total: '480.50',
        sellers_count: 1,
        channel_codes: ['falabella'],
      }] };
      if (sql.includes("= 'nosotros'")) {
        return { rows: [{ shipping_total: '36', district_total: '16', distance_total: '20', deliveries: 1 }] };
      }
      return { rows: [{ code: 'falabella', name: 'Falabella', orders_count: 3, sales_total: '480.50' }] };
    },
  };

  const result = await getSalesPulse({ date: '2026-08-12' }, db);
  assert.equal(result.ordersCount, 3);
  assert.equal(result.salesTotal, 480.5);
  assert.equal(result.unitsSold, 5);
  assert.equal(result.sellersWithSales, 1);
  assert.equal(result.sellersWithoutSales, 1);
  assert.equal(result.sellers[1].companyName, 'Manta Raya');
  assert.equal(result.sellers[1].ordersCount, 0);
  assert.equal(result.topProducts[0].name, 'Producto principal');
  assert.equal(result.topProducts[0].imageUrl, 'https://img.example/p.jpg');
  assert.equal(result.topProducts[0].shopSku, '12345678');
  assert.deepEqual(result.topProducts[0].channelCodes, ['falabella']);
  assert.equal(result.channels[0].ordersCount, 3);
  assert.equal(result.ownFleetShipping.total, 36);
  assert.equal(result.ownFleetShipping.districtTotal, 16);
  assert.equal(result.ownFleetShipping.distanceTotal, 20);
  assert.equal(result.ownFleetShipping.deliveries, 1);
});

test('lista pedidos por fecha comercial de Lima para la vista de hoy', async () => {
  const db = {
    async query(sql, params) {
      assert.match(sql, /at time zone 'America\/Lima'/);
      assert.match(sql, /::date >= \$1::date/);
      assert.match(sql, /::date <= \$2::date/);
      assert.deepEqual(params, ['2026-08-12', '2026-08-12', 10, 0]);
      return { rows: [] };
    },
  };
  const result = await listOrders({ from: '2026-08-12', to: '2026-08-12', limit: 10 }, db);
  assert.equal(result.totalCount, 0);
  assert.deepEqual(result.orders, []);
});

test('la vista por defecto limita marketplaces a sellers activos y conectados', async () => {
  const db = {
    async query(sql) {
      assert.match(sql, /left join companies c on c\.id=o\.company_id/i);
      assert.match(sql, /c\.activo=true/i);
      assert.match(sql, /c\.ripley_api_key/i);
      assert.match(sql, /c\.falabella_api_key/i);
      return { rows: [] };
    },
  };
  await listOrders({ connectedOnly: true }, db);
});

test('regresión: lista ventas manuales aunque no tengan seller (company_id null)', async () => {
  const db = {
    async query(sql) {
      assert.match(sql, /left join companies c on c\.id=o\.company_id/i);
      return {
        rows: [{
          id: 77,
          company_id: null,
          channel_account_id: 22,
          external_order_id: 'VTA-260825040928',
          external_order_number: 'VTA-260825040928',
          order_status: 'confirmed',
          payment_status: 'pending',
          fulfillment_status: 'ready_to_ship',
          document_status: 'pending',
          provider_status: null,
          document_requirement: 'disabled',
          document_type_policy: 'automatic',
          requested_document_type: 'boleta',
          currency: 'PEN',
          subtotal: 50,
          shipping_amount: null,
          discount_amount: null,
          total: 50,
          customer: { name: 'Ana' },
          shipping: { type: 'envio', carrier: 'shaloom' },
          metadata: { origin: 'manual_ui' },
          ordered_at: '2026-08-25T04:09:28.000Z',
          promised_shipping_at: '2026-08-25T17:00:00.000Z',
          provider_updated_at: null,
          items_status: 'complete',
          items_error: null,
          first_seen_at: '2026-08-25T04:09:28.000Z',
          last_seen_at: '2026-08-25T04:09:28.000Z',
          created_at: '2026-08-25T04:09:28.000Z',
          updated_at: '2026-08-25T04:09:28.000Z',
          channel_code: 'manual',
          channel_name: 'Venta manual',
          channel_account_name: 'Mostrador',
          total_count: 1,
        }],
      };
    },
  };

  const result = await listOrders({ from: '2026-08-24', to: '2026-08-24', limit: 50 }, db);
  assert.equal(result.totalCount, 1);
  assert.equal(result.orders[0].externalOrderNumber, 'VTA-260825040928');
  assert.equal(result.orders[0].companyId, null);
  assert.equal(result.orders[0].channelCode, 'manual');
});

test('registra el pago de un pedido pendiente y deja el método en metadata', async () => {
  const order = {
    id: 91,
    company_id: 7,
    channel_account_id: 22,
    external_order_id: 'VTA-1',
    external_order_number: 'VTA-1',
    order_status: 'confirmed',
    payment_status: 'pending',
    fulfillment_status: 'pending',
    document_status: 'pending',
    provider_status: null,
    document_requirement: 'optional',
    document_type_policy: 'automatic',
    requested_document_type: 'boleta',
    currency: 'PEN',
    subtotal: 100,
    shipping_amount: null,
    discount_amount: null,
    total: 100,
    customer: { name: 'Ana' },
    shipping: { type: 'envio' },
    metadata: { paymentMethod: 'despues' },
    ordered_at: '2026-08-17T15:00:00Z',
    promised_shipping_at: null,
    provider_updated_at: null,
    first_seen_at: '2026-08-17T15:00:00Z',
    last_seen_at: '2026-08-17T15:00:00Z',
    created_at: '2026-08-17T15:00:00Z',
    updated_at: '2026-08-17T15:00:00Z',
    channel_code: 'manual',
    channel_name: 'Venta manual',
    channel_account_name: 'Mostrador',
  };
  const queries = [];
  const db = {
    async query(sql, params) {
      const compact = sql.replace(/\s+/g, ' ').trim();
      queries.push({ sql: compact, params });
      if (compact.startsWith('select o.*, ch.code')) return { rows: [order] };
      if (compact.startsWith('update orders')) {
        return {
          rows: [{
            ...order,
            payment_status: params[1],
            metadata: { ...order.metadata, ...JSON.parse(params[2]) },
            updated_at: '2026-08-17T16:00:00Z',
          }],
        };
      }
      return { rows: [] };
    },
  };

  const result = await updateOrderPayment(91, {
    paymentMethod: 'yape_plin',
    receivedBy: '',
    actorUserId: 'user-1',
  }, db);

  assert.equal(result.paymentStatus, 'paid');
  assert.equal(result.metadata.paymentMethod, 'yape_plin');
  assert.equal(result.metadata.paymentMethod === 'despues', false);
  assert.match(queries[1].sql, /payment_status/);
  assert.equal(queries[2].params[1], 'order.payment_recorded');
  assert.equal(queries[2].params[3], 'user-1');
});

test('rechaza un método de pago que no se puede registrar después', async () => {
  await assert.rejects(
    () => updateOrderPayment(91, { paymentMethod: 'despues' }, { query: async () => ({ rows: [] }) }),
    /paymentMethod inválido/,
  );
});

function manualSale(overrides = {}) {
  const { shipping, ...rest } = overrides;
  return {
    companyId: 7,
    channelAccountId: 22,
    externalOrderId: 'VTA-1',
    externalOrderNumber: 'VTA-1',
    orderStatus: 'confirmed',
    fulfillmentStatus: 'pending',
    total: 50,
    customer: { name: 'Cliente' },
    items: [{
      externalItemId: 'LINE-1',
      sku: 'SKU-1',
      description: 'Producto',
      quantity: 1,
      unitPrice: 50,
      total: 50,
    }],
    itemsComplete: true,
    source: 'manual',
    idempotencyKey: 'manual-1',
    ...rest,
    shipping: { type: 'envio', ...shipping },
  };
}

test('rechaza una venta manual Envío sin repartidor', async () => {
  await assert.rejects(
    () => ingestOrder(manualSale({ shipping: { type: 'envio' } }), new IngestDb()),
    /El envío requiere un repartidor: Marvisuar, Shaloom, Dinsides o Express/,
  );
});

test('rechaza una venta manual con pin fuera del Perú', async () => {
  await assert.rejects(
    () => ingestOrder(manualSale({
      shipping: { type: 'envio', carrier: 'shaloom', lat: 40.4168, lng: -3.7038 },
    }), new IngestDb()),
    /Esa dirección no está en el Perú/,
  );
});

test('rechaza una venta manual Envío con un repartidor que no está en la lista', async () => {
  await assert.rejects(
    () => ingestOrder(manualSale({ shipping: { type: 'envio', carrier: 'otro' } }), new IngestDb()),
    /El envío requiere un repartidor: Marvisuar, Shaloom, Dinsides o Express/,
  );
});

test('acepta una venta manual Recojo sin repartidor', async () => {
  const result = await ingestOrder(
    manualSale({ shipping: { type: 'recojo' } }),
    new IngestDb(),
  );
  assert.equal(result.created, true);
  assert.equal(result.order.shipping.type, 'recojo');
  assert.equal(result.order.shipping.carrier, undefined);
});

test('acepta una venta manual Envío con Marvisuar, Shaloom o Dinsides', async () => {
  const result = await ingestOrder(
    manualSale({ shipping: { type: 'envio', carrier: 'shaloom' } }),
    new IngestDb(),
  );
  assert.equal(result.created, true);
  assert.equal(result.order.shipping.carrier, 'shaloom');
});

test('Express persiste la zona, la distancia informativa y el total con envío', async () => {
  const result = await ingestOrder(manualSale({
    subtotal: 250,
    total: 250,
    shipping: {
      type: 'envio',
      carrier: 'nosotros',
      district: 'San Miguel',
      province: 'Lima',
      department: 'Lima',
      lat: -12.0776,
      lng: -77.0905,
    },
  }), new IngestDb());
  assert.equal(result.created, true);
  assert.equal(result.order.shipping.carrier, 'nosotros');
  assert.equal(result.order.shippingAmount, 15);
  assert.equal(result.order.total, 265);
  assert.equal(result.order.shipping.priceZone, 'Media');
  assert.equal(result.order.shipping.districtAmount, 15);
  // La distancia se guarda como referencia, no como cobro.
  assert.equal(result.order.shipping.distanceAmount, 0);
  assert.ok(result.order.shipping.distanceKm > 10);
});

test('regresión: una venta manual conserva la fecha de entrega (promisedShippingAt)', async () => {
  const db = new IngestDb(account({ channel_code: 'manual' }));
  const result = await ingestOrder(manualSale({
    shipping: { type: 'envio', carrier: 'marvisuar' },
    promisedShippingAt: '2026-08-25T12:00:00-05:00',
    metadata: {
      origin: 'manual_ui',
      delivery: 'envio',
      deliveryDate: '2026-08-25',
      shippingCarrier: 'marvisuar',
      paymentMethod: 'despues',
    },
  }), db);

  assert.equal(result.created, true);
  assert.equal(result.order.promisedShippingAt, '2026-08-25T17:00:00.000Z');
  assert.equal(result.order.metadata.deliveryDate, '2026-08-25');
  assert.equal(result.order.metadata.origin, 'manual_ui');

  const insert = db.queries.find((query) => query.sql.startsWith('insert into orders'));
  assert.ok(insert, 'debe persistir el pedido');
  assert.equal(insert.params[21], '2026-08-25T17:00:00.000Z');
});

test('ingresa created_by del actor y no lo pisa en actualizaciones posteriores', async () => {
  const db = new IngestDb();
  const result = await ingestOrder(manualSale({
    shipping: { type: 'recojo' },
    actorUserId: 'seller-9',
  }), db);
  const insert = db.queries.find((query) => query.sql.startsWith('insert into orders'));
  assert.ok(insert.sql.includes('created_by'));
  assert.equal(insert.params[25], 'seller-9');
  assert.match(insert.sql, /created_by=coalesce\(orders\.created_by, excluded\.created_by\)/);
  assert.equal(result.order.createdBy, 'seller-9');
});

test('lista pedidos filtrando por createdBy', async () => {
  const db = {
    async query(sql, params) {
      assert.match(sql, /o\.created_by=\$1/);
      assert.equal(params[0], 'seller-9');
      return { rows: [] };
    },
  };
  const result = await listOrders({ createdBy: 'seller-9', limit: 20 }, db);
  assert.equal(result.totalCount, 0);
});

test('lista pedidos ordenando por total o fecha con una lista blanca', async () => {
  const seen = [];
  const db = {
    async query(sql) {
      seen.push(sql.replace(/\s+/g, ' '));
      return { rows: [] };
    },
  };
  await listOrders({ sortBy: 'total', sortDir: 'asc' }, db);
  await listOrders({ sortBy: 'orderedAt', sortDir: 'desc' }, db);
  await listOrders({ sortBy: 'customer; drop table orders', sortDir: 'asc' }, db);
  assert.match(seen[0], /order by o\.total asc nulls first, o\.id asc/);
  assert.match(seen[1], /order by coalesce\(o\.ordered_at, o\.created_at\) desc nulls last, o\.id desc/);
  assert.match(seen[2], /order by o\.ordered_at desc nulls last, o\.id desc/);
  assert.doesNotMatch(seen[2], /drop table/);
});

test('lista cancelados y devueltos por la fecha en que pasaron a ese estado', async () => {
  const seen = [];
  const db = {
    async query(sql, params) {
      seen.push({ sql: sql.replace(/\s+/g, ' '), params });
      return { rows: [] };
    },
  };
  await listCanceledOrders({ from: '2026-08-01', to: '2026-08-31', limit: 50 }, db);
  assert.match(seen[0].sql, /fulfillment_status in \('cancelled', 'returned'\)/);
  assert.match(seen[0].sql, /cancelled_at/);
  assert.match(seen[0].sql, /returned_at/);
  assert.match(seen[0].sql, /from order_items oi/);
  assert.match(seen[0].sql, /left join products p on p.id=oi.product_id/);
  assert.match(seen[0].sql, /p\.image_url/);
  assert.match(seen[0].sql, /listing\.shop_sku/);
  assert.match(seen[0].sql, /rsa\.stock_quantity/);
  assert.match(seen[0].sql, /'approvalId', rsa.id/);
  assert.deepEqual(seen[0].params, ['2026-08-01', '2026-08-31', 50, 0]);

  await listCanceledOrders({ kind: 'returned', from: '2026-08-20', to: '2026-08-20' }, db);
  assert.match(seen[1].sql, /o\.fulfillment_status='returned' or exists \(select 1 from return_stock_approvals rsa where rsa.order_id=o.id\)/);
  assert.doesNotMatch(seen[1].sql, /fulfillment_status in \('cancelled', 'returned'\)/);

  await listCanceledOrders({ approval: 'pending', from: '2026-09-03', to: '2026-09-04' }, db);
  assert.match(seen[2].sql, /return_stock_approvals rsa where rsa.order_id=o.id and rsa.status='pending'/);
});

test('expone la foto y el shop sku de cada ítem cancelado', async () => {
  const db = {
    async query() {
      return {
        rows: [{
          id: 44,
          company_id: 7,
          nombre: 'LIMBO SAC',
          nombre_comercial: 'LIMBO',
          razon_social: 'LIMBO SAC',
          channel_code: 'falabella',
          channel_name: 'Falabella',
          external_order_id: 'PV-10004',
          external_order_number: 'PV-10004',
          order_status: 'cancelled',
          fulfillment_status: 'cancelled',
          currency: 'PEN',
          total: '189.90',
          items: [{
            name: 'Coche bastón',
            sku: 'AG301',
            quantity: 1,
            imageUrl: 'https://img.example/ag301.jpg',
            shopSku: '118765881',
          }],
          total_count: 1,
        }],
      };
    },
  };
  const result = await listCanceledOrders({}, db);
  assert.equal(result.orders[0].items[0].imageUrl, 'https://img.example/ag301.jpg');
  assert.equal(result.orders[0].items[0].shopSku, '118765881');
  assert.equal(result.orders[0].companyName, 'Limbo');
});

test('la serie diaria rellena con cero los días sin venta y estima comisión', () => {
  const daily = fillDailySales(
    [
      { lima_date: '2026-08-24', orders_count: 2, sales_total: '200.00' },
      { lima_date: '2026-08-26', orders_count: 1, sales_total: '50.00' },
    ],
    '2026-08-23',
    '2026-08-26',
    10,
  );
  assert.deepEqual(daily, [
    { date: '2026-08-23', orders: 0, total: 0, commission: 0 },
    { date: '2026-08-24', orders: 2, total: 200, commission: 20 },
    { date: '2026-08-25', orders: 0, total: 0, commission: 0 },
    { date: '2026-08-26', orders: 1, total: 50, commission: 5 },
  ]);
});

test('la comisión estimada es el porcentaje sobre el total', () => {
  assert.equal(estimatedCommission(200, 10), 20);
  assert.equal(estimatedCommission(99.99, 0), 0);
  assert.equal(estimatedCommission(100, 5.5), 5.5);
});

test('el home del vendedor resume hoy, mes y pedidos propios', async () => {
  const queries = [];
  const db = {
    async query(sql, params) {
      const compact = sql.replace(/\s+/g, ' ').trim();
      queries.push({ sql: compact, params });
      if (compact.includes('today_orders')) {
        return { rows: [{ today_orders: 2, today_total: '200.00', month_orders: 5, month_total: '800.00' }] };
      }
      if (compact.includes('group by d.lima_date')) {
        return { rows: [{ lima_date: params[2], orders_count: 2, sales_total: '200.00' }] };
      }
      if (compact.includes("metadata->>'paymentMethod'")) {
        return { rows: [
          { payment_method: 'efectivo', orders_count: 3, sales_total: '500.00' },
          { payment_method: 'yape_plin', orders_count: 2, sales_total: '300.00' },
        ] };
      }
      return { rows: [{
        id: 91,
        company_id: 7,
        channel_account_id: 22,
        external_order_id: 'VTA-1',
        external_order_number: 'VTA-1',
        order_status: 'confirmed',
        payment_status: 'paid',
        fulfillment_status: 'ready_to_ship',
        document_status: 'pending',
        provider_status: null,
        document_requirement: 'optional',
        document_type_policy: 'automatic',
        requested_document_type: 'boleta',
        currency: 'PEN',
        subtotal: 200,
        shipping_amount: null,
        discount_amount: null,
        total: 200,
        customer: { name: 'Ana' },
        shipping: { type: 'recojo' },
        metadata: { paymentMethod: 'efectivo' },
        ordered_at: '2026-08-24T15:00:00Z',
        promised_shipping_at: null,
        provider_updated_at: null,
        first_seen_at: '2026-08-24T15:00:00Z',
        last_seen_at: '2026-08-24T15:00:00Z',
        created_at: '2026-08-24T15:00:00Z',
        updated_at: '2026-08-24T15:00:00Z',
        created_by: 'seller-9',
        channel_code: 'manual',
        channel_name: 'Venta manual',
        channel_account_name: 'Mostrador',
        total_count: 1,
      }] };
    },
  };
  const result = await getSalespersonHome({
    userId: 'seller-9',
    commissionPercent: 10,
    from: '2026-08-20',
    to: '2026-08-26',
    limit: 10,
    offset: 10,
    sortBy: 'total',
    sortDir: 'asc',
  }, db);
  assert.deepEqual(result.today, { orders: 2, total: 200, commission: 20 });
  assert.deepEqual(result.month, { orders: 5, total: 800, commission: 80 });
  assert.deepEqual(result.range, { from: '2026-08-20', to: '2026-08-26' });
  assert.equal(result.daily.length, 7);
  assert.deepEqual(result.daily[6], { date: '2026-08-26', orders: 2, total: 200, commission: 20 });
  assert.deepEqual(result.daily[0], { date: '2026-08-20', orders: 0, total: 0, commission: 0 });
  assert.deepEqual(result.paymentMix, [
    { method: 'efectivo', orders: 3, total: 500 },
    { method: 'yape_plin', orders: 2, total: 300 },
  ]);
  assert.equal(result.orders[0].createdBy, 'seller-9');
  assert.equal(result.ordersTotal, 1);
  assert.equal(result.limit, 10);
  assert.equal(result.offset, 10);
  for (const query of queries) {
    assert.equal(query.params[0], 'seller-9');
    assert.match(query.sql, /created_by=\$1/);
    assert.match(query.sql, /cancelled/);
  }
  const list = queries.find((query) => query.sql.includes('total_count'));
  assert.match(list.sql, /order by o\.total asc/);
  assert.deepEqual(list.params.slice(-2), [10, 10]);
});

test('el home del vendedor rechaza un rango invertido', async () => {
  await assert.rejects(
    getSalespersonHome({ userId: 'seller-9', from: '2026-08-26', to: '2026-08-20' }, { async query() { return { rows: [] }; } }),
    /rango de fechas/,
  );
});
