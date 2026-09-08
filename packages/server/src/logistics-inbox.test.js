import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import {
  logisticsStage,
  parseLogisticsInboxFilters,
  parsePrintSelection,
  listLogisticsInbox,
  limaTomorrowDate,
  markLogisticsOrderReady,
  printLogisticsPack,
  ripleyOrderLookupIds,
  scheduleRipleyInboxReady,
  urgencyForDeadline,
  groupLogisticsItems,
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
    if (compact.includes("ch.code = 'ripley'") && compact.includes("fulfillment_status = 'ready_to_ship'")) {
      return { rows: [] };
    }
    if (compact.includes('as pending_count')) {
      return { rows: [{ pending_count: 2, ready_count: 1, shipped_count: 0 }] };
    }
    if (compact.includes('as date') && compact.includes('group by 1')) {
      return { rows: [{ date: '2026-09-08', count: 2 }] };
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
          sku: 'S126718',
          main_sku: 'HOG025',
          provider_sku: 'S126718',
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
  assert.equal(result.orders[0].items[0].sku, 'HOG025');
  assert.equal(result.orders[0].items[0].mainSku, 'HOG025');
  assert.equal(result.stage, 'pending');
  assert.equal(db.queries.length, 4);
  assert.match(db.queries[0].sql, /ch\.code = 'ripley'/);
  assert.match(db.queries[2].sql, /fulfillment_status = any/);
  assert.match(db.queries[2].sql, /promised_shipping_at is not null/);
  assert.match(db.queries[2].sql, /p\.main_sku/);
  assert.match(db.queries[2].sql, /warehouse_address/);
  assert.match(db.queries[1].sql, /promised_shipping_at is not null/);
  assert.match(db.queries[3].sql, /promised_shipping_at >= now\(\)/);
  assert.deepEqual(result.counts.dates, [{ date: '2026-09-08', count: 2 }]);
});

async function stubLabelPdf(text = 'FALABELLA') {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 320]).drawText(text, { x: 20, y: 280, size: 12 });
  return { base64: Buffer.from(await pdf.save()).toString('base64') };
}

class PrintDb {
  constructor(rows) {
    this.rows = rows;
    this.queries = [];
  }

  async query(sql, params = []) {
    this.queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    if (sql.includes('logistics_label_prints')) return { rows: [] };
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
  const db = new PrintDb([printRow()]);
  const result = await printLogisticsPack(
    { orderIds: [10], printedBy: 'operator@zentofact.local' },
    { db },
  );
  assert.equal(result.ok, true);
  assert.equal(result.mimeType, 'application/pdf');
  assert.equal(result.labelCount, 1);
  assert.ok(result.packingPageCount >= 1);
  assert.equal(result.skipped.length, 0);
  const pdf = await PDFDocument.load(Buffer.from(result.base64, 'base64'));
  assert.ok(pdf.getPageCount() >= 2);
  const record = db.queries.find((query) => query.sql.includes('insert into logistics_label_prints'));
  assert.ok(record, 'registra la impresión');
  assert.deepEqual(record.params[0], [10]);
  assert.equal(record.params[1], 'operator@zentofact.local');
});

test('la consulta de bandeja lee fotos Ripley de product_medias', async () => {
  const db = new InboxDb();
  await listLogisticsInbox({ stage: 'pending' }, db);
  const listSql = db.queries.find((query) => query.sql.includes('image_url'))?.sql || '';
  assert.match(listSql, /product_medias/);
  assert.match(listSql, /media_url/);
});

for (const mediaUrl of [
  'https://home.ripley.com.pe/desk.jpg',
  '/media/product/image/2bdc44c6-94f2-4927-8a86-6c199e72f2ff',
]) {
  test(`usa la foto Ripley sin asociación al catálogo: ${mediaUrl}`, async () => {
    const db = new InboxDb();
    db.queries = [];
    const original = db.query.bind(db);
    db.query = async (sql, params = []) => {
      const result = await original(sql, params);
      if (result.rows[0]?.items) {
        result.rows[0].items = [{
          id: 9,
          sku: 'S215629',
          description: 'Escritorio gamer negro',
          quantity: 1,
          image_url: mediaUrl.startsWith('/') ? mediaUrl : '',
          raw_data: { product_medias: [{ media_url: mediaUrl }] },
          metadata: {},
        }];
      }
      return result;
    };
    const result = await listLogisticsInbox({ stage: 'pending' }, db);
    assert.equal(result.orders[0].items[0].imageUrl, new URL(mediaUrl, 'https://ripleyperu-prod.mirakl.net').href);
  });
}

test('agrupa líneas repetidas del mismo producto como una sola con cantidad', () => {
  const grouped = groupLogisticsItems([
    { id: 1, sku: 'BT-1', description: 'Bastón', quantity: 1, imageUrl: '' },
    { id: 2, sku: 'BT-1', description: 'Bastón', quantity: 1, imageUrl: 'https://img/bt.jpg' },
    { id: 3, sku: 'MC-2', description: 'Mochila', quantity: 2, imageUrl: '' },
  ]);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].quantity, 2);
  assert.equal(grouped[0].lineCount, 2);
  assert.equal(grouped[0].imageUrl, 'https://img/bt.jpg');
  assert.equal(grouped[1].quantity, 2);
  assert.equal(grouped[1].lineCount, 1);
});

test('agrupa por SKU maestro aunque el seller SKU cambie', () => {
  const grouped = groupLogisticsItems([
    { id: 1, sku: 'S126718', mainSku: 'HOG025', description: 'Silla', quantity: 1, imageUrl: '' },
    { id: 2, sku: 'S166285', mainSku: 'HOG025', description: 'Silla', quantity: 1, imageUrl: '' },
  ]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].quantity, 2);
  assert.equal(grouped[0].mainSku, 'HOG025');
});

test('clasifica la urgencia de entrega en hora de Lima', () => {
  const now = new Date('2026-09-02T15:00:00.000Z');
  assert.equal(urgencyForDeadline(null, now), 'later');
  assert.equal(urgencyForDeadline('2026-09-02T14:00:00.000Z', now), 'overdue');
  assert.equal(urgencyForDeadline('2026-09-02T22:00:00.000Z', now), 'today');
  assert.equal(urgencyForDeadline('2026-09-03T17:00:00.000Z', now), 'tomorrow');
  assert.equal(urgencyForDeadline('2026-09-05T17:00:00.000Z', now), 'later');
});

test('el filtro de vencidos no exige plazo futuro', async () => {
  const db = new InboxDb();
  await listLogisticsInbox({ stage: 'pending', urgency: 'overdue' }, db);
  assert.match(db.queries[2].sql, /promised_shipping_at < now\(\)/);
  assert.doesNotMatch(db.queries[2].sql, /promised_shipping_at >= now\(\)/);
});

test('filtra por urgencia y expone conteos de prioridad', async () => {
  const db = new InboxDb();
  const result = await listLogisticsInbox({ stage: 'pending', urgency: 'today' }, db);
  assert.match(db.queries[2].sql, /America\/Lima/);
  assert.deepEqual(result.counts.urgency, { overdue: 0, today: 0, tomorrow: 0, later: 0 });
  assert.equal(result.orders[0].urgency, 'later');
  assert.equal(result.orders[0].labelPrint, null);
  assert.throws(() => parseLogisticsInboxFilters({ urgency: 'ayer' }), /Prioridad/);
});

test('filtra por una fecha concreta de plazo', async () => {
  const db = new InboxDb();
  const result = await listLogisticsInbox({ stage: 'pending', deadline: '2026-09-08' }, db);
  assert.equal(parseLogisticsInboxFilters({ deadline: '2026-09-08' }).deadline, '2026-09-08');
  assert.match(db.queries[2].sql, /::date = \$/);
  assert.match(db.queries[3].sql, /group by 1/);
  assert.deepEqual(result.counts.dates, [{ date: '2026-09-08', count: 2 }]);
  assert.throws(() => parseLogisticsInboxFilters({ deadline: '08-09' }), /Fecha/);
  assert.throws(() => parseLogisticsInboxFilters({ deadline: '2026-13-40' }), /Fecha/);
});

test('compone Falabella y deja Ripley fuera de la impresión', async () => {
  let listedRipley = 0;
  const rows = [
    printRow({ id: 21, channel_code: 'falabella', channel_name: 'Falabella', external_order_id: 'F-21' }),
    printRow({ id: 22, channel_code: 'ripley', channel_name: 'Ripley', external_order_id: 'R-22' }),
  ];
  const result = await printLogisticsPack(
    { orderIds: [21, 22], includePacking: false },
    {
      db: new PrintDb(rows),
      getFalabellaLabel: async () => stubLabelPdf('FAL'),
      listRipleyLabels: async () => {
        listedRipley += 1;
        return { labels: [] };
      },
      downloadRipleyLabels: async () => {
        throw new Error('no debe llamarse');
      },
    },
  );
  assert.equal(listedRipley, 0);
  assert.equal(result.labelCount, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].id, 22);
  assert.equal(result.skipped[0].reason, 'Muy pronto.');
  const pdf = await PDFDocument.load(Buffer.from(result.base64, 'base64'));
  assert.equal(pdf.getPageCount(), 1);
});

test('un pedido Ripley no llama a Seller Center y avisa Muy pronto', async () => {
  const lines = [];
  await assert.rejects(
    () => printLogisticsPack(
      { orderIds: [32], includePacking: false },
      {
        db: new PrintDb([printRow({
          id: 32,
          channel_code: 'ripley',
          channel_name: 'Ripley',
          external_order_id: 'R-32',
        })]),
        listRipleyLabels: async () => {
          throw new Error('no debe llamarse');
        },
        downloadRipleyLabels: async () => ({ labels_generated: '' }),
        createLogId: () => 'log_eeeeeeeeeeee',
        log: (line) => lines.push(line),
      },
    ),
    (error) => {
      assert.equal(error.message, 'Muy pronto.');
      assert.equal(error.logId, 'log_eeeeeeeeeeee');
      assert.equal(error.details.skipped[0].reason, 'Muy pronto.');
      return true;
    },
  );
  const payload = JSON.parse(lines.find((line) => String(line).includes('logistics.print.failed')));
  assert.equal(payload.logId, 'log_eeeeeeeeeeee');
  assert.equal(payload.orders[0].externalOrderId, 'R-32');
});

test('un PDF inválido de Falabella no se cubre con Ripley', async () => {
  const lines = [];
  await assert.rejects(
    () => printLogisticsPack(
      { orderIds: [51, 52], includePacking: false },
      {
        db: new PrintDb([
          printRow({ id: 51, channel_code: 'falabella', channel_name: 'Falabella', external_order_id: 'F-51' }),
          printRow({ id: 52, channel_code: 'ripley', channel_name: 'Ripley', external_order_id: 'R-52' }),
        ]),
        getFalabellaLabel: async () => ({ base64: Buffer.from('<html>error</html>').toString('base64') }),
        listRipleyLabels: async () => ({ labels: [{ document_id: 'doc-52', order_id: 'R-52' }] }),
        downloadRipleyLabels: async () => ({ labels_generated: (await stubLabelPdf('RIP')).base64 }),
        createLogId: () => 'log_cccccccccccc',
        log: (line) => lines.push(line),
      },
    ),
    (error) => {
      assert.match(error.message, /vacía/);
      assert.equal(error.details.skipped.find((entry) => entry.id === 52).reason, 'Muy pronto.');
      return true;
    },
  );
  assert.match(lines.find((line) => String(line).includes('logistics.print.failed')) || '', /log_cccccccccccc/);
});

test('arma los ids de búsqueda Ripley sin repetir', () => {
  assert.deepEqual(ripleyOrderLookupIds({
    externalOrderId: '7935256701-A',
    externalOrderNumber: '7935256701',
    metadata: { commercialId: '7935256701', ripleySvc: { orderId: 'svc-1' } },
  }), ['7935256701-A', '7935256701', 'svc-1']);
  assert.deepEqual(ripleyOrderLookupIds({
    externalOrderId: '7935614201-A',
    metadata: '{"commercialId":"7935614201"}',
  }), ['7935614201-A', '7935614201']);
});

test('la fecha de recojo Ripley es el día siguiente en Lima', () => {
  assert.equal(limaTomorrowDate(new Date('2026-09-07T15:00:00.000Z')), '2026-09-08');
});

test('agenda recojo Ripley y deja el pedido listo para enviar', async () => {
  const updates = [];
  const listed = [];
  const scheduled = [];
  const enqueued = [];
  const db = {
    async query(sql, params) {
      updates.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (sql.includes('update orders')) {
        return { rows: [{ id: 20, fulfillment_status: 'ready_to_ship', metadata: {} }] };
      }
      return { rows: [] };
    },
  };
  const result = await scheduleRipleyInboxReady({
    id: 20,
    companyId: 7,
    externalOrderId: '7935614201-A',
    externalOrderNumber: '7935614201',
    warehouseAddress: 'Av. Demo 101, Lima',
    hasRipleySvcCredentials: false,
    metadata: {},
    orderedAt: '2026-09-04T10:00:00.000Z',
  }, { pickupDate: '2026-09-08' }, {
    db,
    listEligible: async (filter) => {
      listed.push(filter);
      return { labels: [{ _id: 'label-1', order_id: filter.orderId }] };
    },
    schedule: async (companyId, data) => {
      scheduled.push({ companyId, data });
      return { manifests: [{ _id: 'man-1' }] };
    },
    enqueue: async (job) => {
      enqueued.push(job);
      return { enqueued: true };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.alreadyReady, false);
  assert.equal(result.sandbox, true);
  assert.equal(result.pickupDate, '2026-09-08');
  assert.equal(result.manifestId, 'man-1');
  assert.equal(listed[0].sandbox, true);
  assert.deepEqual(scheduled[0].data.labelIds, ['label-1']);
  assert.equal(scheduled[0].data.sandbox, true);
  assert.match(JSON.stringify(updates[0].params[1]), /TO_PICKUP/);
  assert.equal(enqueued[0].orderId, 20);
});

test('marcar listo en bandeja agenda recojo solo en Ripley', async () => {
  const rows = [{
    id: 20,
    company_id: 7,
    external_order_id: 'R-20',
    external_order_number: 'RP-10020',
    fulfillment_status: 'pending',
    ordered_at: '2026-09-02T10:00:00.000Z',
    metadata: {},
    channel_code: 'ripley',
    warehouse_address: 'Av. Demo 101, Lima',
    has_ripley_svc_credentials: false,
  }];
  const db = {
    async query(sql, params) {
      if (sql.includes('from orders o')) return { rows };
      if (sql.includes('update orders')) {
        return { rows: [{ id: 20, fulfillment_status: 'ready_to_ship', metadata: {} }] };
      }
      return { rows: [] };
    },
  };
  const result = await markLogisticsOrderReady({ orderId: 20, pickupDate: '2026-09-08' }, {
    db,
    listEligible: async () => ({ labels: [{ _id: 'label-1', order_id: 'R-20' }] }),
    schedule: async () => ({ manifests: [{ _id: 'man-1' }] }),
    enqueue: async () => ({ enqueued: true }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.pickupDate, '2026-09-08');

  await assert.rejects(
    () => markLogisticsOrderReady({ orderId: 21 }, {
      db: {
        async query() {
          return { rows: [{ ...rows[0], id: 21, channel_code: 'falabella' }] };
        },
      },
    }),
    /no se agenda en Ripley/,
  );
});

test('un Ripley ya listo no vuelve a agendar el recojo', async () => {
  const result = await markLogisticsOrderReady({ orderId: 22 }, {
    db: {
      async query() {
        return {
          rows: [{
            id: 22,
            channel_code: 'ripley',
            fulfillment_status: 'ready_to_ship',
          }],
        };
      },
    },
  });
  assert.deepEqual(result, { ok: true, alreadyReady: true, orderId: 22 });
});
