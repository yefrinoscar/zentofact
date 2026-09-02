import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import {
  logisticsStage,
  parseLogisticsInboxFilters,
  parsePrintSelection,
  listLogisticsInbox,
  printLogisticsPack,
} from './logistics-inbox.js';

test('agrupa el estado de entrega en etapas de bandeja', () => {
  assert.equal(logisticsStage('pending'), 'pending');
  assert.equal(logisticsStage('preparing'), 'pending');
  assert.equal(logisticsStage('ready_to_ship'), 'ready');
  assert.equal(logisticsStage('shipped'), 'shipped');
  assert.equal(logisticsStage('delivered'), 'shipped');
  assert.equal(logisticsStage('cancelled'), 'other');
});

test('rechaza filtros de bandeja inválidos', () => {
  assert.equal(parseLogisticsInboxFilters({}).stage, 'pending');
  assert.equal(parseLogisticsInboxFilters({ channelCode: 'ripley' }).channelCode, 'ripley');
  assert.throws(() => parseLogisticsInboxFilters({ stage: 'hoy' }), /Etapa/);
  assert.throws(() => parseLogisticsInboxFilters({ channelCode: 'amazon' }), /Canal/);
  assert.throws(() => parseLogisticsInboxFilters({ companyId: 'x' }), /Tienda/);
});

test('la impresión pide ids concretos y tope', () => {
  assert.deepEqual(parsePrintSelection({ orderIds: [3, '3', 8] }).orderIds, [3, 8]);
  assert.equal(parsePrintSelection({ orderIds: [1] }).includePacking, true);
  assert.throws(() => parsePrintSelection({ orderIds: [] }), /al menos un pedido/);
});

class InboxDb {
  constructor() {
    this.queries = [];
  }

  async query(sql, params = []) {
    const compact = sql.replace(/\s+/g, ' ').trim();
    this.queries.push({ sql: compact, params });
    if (compact.includes('as pending_count')) {
      return { rows: [{ pending_count: 2, ready_count: 1, shipped_count: 0 }] };
    }
    return {
      rows: [{
        id: 44,
        company_id: 7,
        channel_account_id: 3,
        external_order_id: 'MAN-44',
        external_order_number: 'QNC44',
        order_status: 'confirmed',
        fulfillment_status: 'pending',
        provider_status: null,
        currency: 'PEN',
        total: 80,
        customer: { name: 'Ana Ruiz' },
        shipping: { type: 'recojo' },
        metadata: {},
        ordered_at: '2026-09-02T12:00:00.000Z',
        promised_shipping_at: null,
        created_at: '2026-09-02T12:00:00.000Z',
        updated_at: '2026-09-02T12:00:00.000Z',
        channel_code: 'manual',
        channel_name: 'Venta manual',
        channel_account_name: 'Mostrador',
        company_name: 'LIMBO',
        items: [{
          id: 1,
          sku: 'ZF-1',
          provider_sku: null,
          description: 'Botella',
          quantity: 2,
          raw_data: {},
          metadata: {},
        }],
        label_prints: [],
        total_count: 1,
      }],
    };
  }
}

test('lista la bandeja con conteos por etapa y productos', async () => {
  const db = new InboxDb();
  const result = await listLogisticsInbox({ stage: 'pending', search: 'QNC' }, db);
  assert.equal(result.counts.pending, 2);
  assert.equal(result.counts.ready, 1);
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].channelCode, 'manual');
  assert.equal(result.orders[0].itemsCount, 2);
  assert.equal(result.orders[0].items[0].sku, 'ZF-1');
  assert.equal(result.stage, 'pending');
  assert.equal(db.queries.length, 2);
  assert.match(db.queries[1].sql, /fulfillment_status = any/);
});

async function stubLabelPdf(text = 'FALABELLA') {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 320]).drawText(text, { x: 20, y: 280, size: 12 });
  return { base64: Buffer.from(await pdf.save()).toString('base64') };
}

class PrintDb {
  constructor(rows) {
    this.rows = rows;
  }

  async query() {
    return { rows: this.rows };
  }
}

function printRow(overrides = {}) {
  return {
    id: 10,
    company_id: 7,
    channel_account_id: 2,
    external_order_id: 'EXT-10',
    external_order_number: 'NUM-10',
    order_status: 'confirmed',
    fulfillment_status: 'ready_to_ship',
    provider_status: 'ready_to_ship',
    currency: 'PEN',
    total: 50,
    customer: { name: 'Lucía' },
    shipping: { type: 'envio', carrier: 'nosotros', address: 'Jr. Unión 100' },
    metadata: {},
    ordered_at: '2026-09-02T10:00:00.000Z',
    promised_shipping_at: null,
    created_at: '2026-09-02T10:00:00.000Z',
    updated_at: '2026-09-02T10:00:00.000Z',
    channel_code: 'manual',
    channel_name: 'Venta manual',
    channel_account_name: 'Mostrador',
    company_name: 'LIMBO',
    items: [{
      id: 1, sku: 'SKU-1', provider_sku: null, description: 'Polo', quantity: 1, raw_data: {}, metadata: {},
    }],
    ...overrides,
  };
}

test('imprime etiqueta manual y guía de armado en un solo PDF', async () => {
  const result = await printLogisticsPack(
    { orderIds: [10] },
    { db: new PrintDb([printRow()]) },
  );
  assert.equal(result.ok, true);
  assert.equal(result.mimeType, 'application/pdf');
  assert.equal(result.labelCount, 1);
  assert.ok(result.packingPageCount >= 1);
  assert.equal(result.skipped.length, 0);
  const pdf = await PDFDocument.load(Buffer.from(result.base64, 'base64'));
  assert.ok(pdf.getPageCount() >= 2);
});

test('compone Falabella y omite Ripley sin etiqueta', async () => {
  const rows = [
    printRow({ id: 21, channel_code: 'falabella', channel_name: 'Falabella', external_order_id: 'F-21' }),
    printRow({ id: 22, channel_code: 'ripley', channel_name: 'Ripley', external_order_id: 'R-22' }),
  ];
  const result = await printLogisticsPack(
    { orderIds: [21, 22], includePacking: false },
    {
      db: new PrintDb(rows),
      getFalabellaLabel: async () => stubLabelPdf('FAL'),
      listRipleyLabels: async () => ({ labels: [] }),
      downloadRipleyLabels: async () => ({ labels_generated: '' }),
    },
  );
  assert.equal(result.labelCount, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].id, 22);
  assert.match(result.skipped[0].reason, /etiqueta/);
});
