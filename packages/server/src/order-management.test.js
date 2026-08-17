import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSalesPulse,
  ingestOrder,
  listOrders,
  resolveDocumentDecision,
} from './order-management.js';
import { mapFalabellaCanonicalStatus, mapFalabellaOrderItems } from './order-adapters/falabella.js';

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
  }

  async query(sql, params = []) {
    const compact = sql.replace(/\s+/g, ' ').trim();
    this.queries.push({ sql: compact, params });
    if (compact.startsWith('select a.*, ch.code as channel_code')) return { rows: [this.account] };
    if (compact.startsWith('select * from orders')) return { rows: [] };
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
        first_seen_at: '2026-07-30T15:00:00Z',
        last_seen_at: '2026-07-30T15:00:00Z',
        created_at: '2026-07-30T15:00:00Z',
        updated_at: '2026-07-30T15:00:00Z',
      }] };
    }
    if (compact.startsWith('insert into order_snapshots')) return { rows: [{ id: 1 }] };
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
  assert.equal(result.order.documentDecision.type, 'factura');
  const itemUpsert = db.queries.find((query) => query.sql.startsWith('insert into order_items'));
  assert.ok(itemUpsert);
  assert.equal(itemUpsert.sql.split(' values ')[0].includes('product_id'), false);
  assert.match(itemUpsert.sql, /returning id, external_item_id.*stock_revision/);
  assert.equal(db.queries.some((query) => query.sql.startsWith('insert into order_snapshots')), true);
  const event = db.queries.find((query) => query.sql.startsWith('insert into order_events'));
  assert.equal(event.params[1], 'order.created');
  assert.equal(event.params[4], 'request-100');
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
