import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ingestOrder,
  resolveDocumentDecision,
} from './order-management.js';
import { mapFalabellaCanonicalStatus } from './order-adapters/falabella.js';

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
  assert.equal(db.queries.some((query) => query.sql.startsWith('insert into order_items')), true);
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
