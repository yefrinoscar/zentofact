import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import {
  logisticsStage,
  parseLogisticsInboxFilters,
  parsePrintSelection,
  listLogisticsInbox,
  markLogisticsOrderDelivered,
  markLogisticsOrderReady,
  printLogisticsPack,
  ripleyOrderLookupIds,
  scheduleRipleyInboxReady,
  urgencyForDeadline,
  groupLogisticsItems,
  countOpenOverdueOrders,
} from './logistics-inbox.js';
import {
  alignFalabellaHeaderWithClosedFulfillment,
  closeOverdueFalabellaFulfillment,
  closeStaleFalabellaFulfillment,
  closedFalabellaFulfillment,
} from './order-adapters/falabella.js';
import { closeStaleRipleyShippedFulfillment } from './order-adapters/ripley.js';

function inboxSql(db, fragment) {
  return db.queries.find((query) => query.sql.includes(fragment))?.sql || '';
}

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
  assert.deepEqual(parsePrintSelection({ orderIds: [1] }), { orderIds: [1] });
  assert.equal(parsePrintSelection({ orderIds: Array.from({ length: 300 }, (_, index) => index + 1) }).orderIds.length, 300);
  assert.throws(() => parsePrintSelection({ orderIds: [] }), /al menos un pedido/);
});

class InboxDb {
  constructor() {
    this.queries = [];
  }

  async query(sql, params = []) {
    const compact = sql.replace(/\s+/g, ' ').trim();
    this.queries.push({ sql: compact, params });
    if (compact.startsWith('update falabella_orders') || compact.startsWith('update falabella_order_lifecycle')) {
      return { rowCount: 0, rows: [] };
    }
    if (compact.startsWith('select o.id, o.fulfillment_status, o.provider_status, fo.status as falabella_status')) {
      return { rows: [] };
    }
    if (compact.startsWith('select o.id, o.provider_status, o.fulfillment_status, o.metadata')) {
      return { rows: [] };
    }
    if (compact.includes('as pending_count')) {
      return { rows: [{ pending_count: 2, ready_count: 1, ready_unprinted_count: 1, shipped_count: 0 }] };
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
  const result = await listLogisticsInbox({ stage: 'pending', search: 'QNC' }, db, { ripleyEnabled: true });
  assert.equal(result.counts.pending, 2);
  assert.equal(result.counts.ready, 1);
  assert.equal(result.counts.readyUnprinted, 1);
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].channelCode, 'manual');
  assert.equal(result.orders[0].itemsCount, 2);
  assert.equal(result.orders[0].items[0].sku, 'HOG025');
  assert.equal(result.orders[0].items[0].mainSku, 'HOG025');
  assert.equal(result.stage, 'pending');
  const listSql = inboxSql(db, 'fulfillment_status = any');
  const countSql = inboxSql(db, 'as pending_count');
  const dateSql = inboxSql(db, 'group by 1');
  assert.match(listSql, /fulfillment_status = any/);
  assert.match(listSql, /::date >= /);
  assert.match(listSql, /ch\.code = 'manual'/);
  assert.match(listSql, /p\.main_sku/);
  assert.match(listSql, /warehouse_address/);
  assert.match(listSql, /falabella_orders fo/);
  assert.match(countSql, /::date >= /);
  assert.match(countSql, /ch\.code = 'manual'/);
  assert.match(countSql, /falabella_orders fo/);
  assert.match(countSql, /ready_unprinted_count/);
  assert.match(countSql, /logistics_label_prints/);
  assert.match(countSql, /falabella_label_prints/);
  assert.match(dateSql, /America\/Lima/);
  assert.match(dateSql, /::date >= /);
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

test('imprime solo la etiqueta manual', async () => {
  const db = new PrintDb([printRow()]);
  const result = await printLogisticsPack(
    { orderIds: [10], printedBy: 'operator@zentofact.local' },
    { db },
  );
  assert.equal(result.ok, true);
  assert.equal(result.mimeType, 'application/pdf');
  assert.equal(result.labelCount, 1);
  assert.equal(result.skipped.length, 0);
  const pdf = await PDFDocument.load(Buffer.from(result.base64, 'base64'));
  assert.equal(pdf.getPageCount(), 1);
  const record = db.queries.find((query) => query.sql.includes('insert into logistics_label_prints'));
  assert.ok(record, 'registra la impresión');
  assert.deepEqual(record.params[0], [10]);
  assert.equal(record.params[1], 'operator@zentofact.local');
});

test('la consulta de bandeja lee fotos Ripley de product_medias', async () => {
  const db = new InboxDb();
  await listLogisticsInbox({ stage: 'pending' }, db, { ripleyEnabled: true });
  const listSql = db.queries.find((query) => query.sql.includes('image_url'))?.sql || '';
  assert.match(listSql, /product_medias/);
  assert.match(listSql, /media_url/);
});

test('la bandeja operativa excluye Falabella', async () => {
  const db = new InboxDb();
  const result = await listLogisticsInbox({ stage: 'pending' }, db, { ripleyEnabled: true });
  const listSql = db.queries.find((query) => query.sql.includes('image_url'))?.sql || '';
  assert.match(listSql, /ch\.code <> 'falabella'/);
  assert.equal(result.channels.falabella, false);
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
    const result = await listLogisticsInbox({ stage: 'pending' }, db, { ripleyEnabled: true });
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
  assert.equal(urgencyForDeadline('2026-09-01T22:00:00.000Z', now), 'overdue');
  assert.equal(urgencyForDeadline('2026-09-02T14:00:00.000Z', now), 'today');
  assert.equal(urgencyForDeadline('2026-09-02T22:00:00.000Z', now), 'today');
  assert.equal(urgencyForDeadline('2026-09-03T17:00:00.000Z', now), 'tomorrow');
  assert.equal(urgencyForDeadline('2026-09-05T17:00:00.000Z', now), 'later');
  const night = new Date('2026-09-08T03:06:00.000Z');
  assert.equal(urgencyForDeadline('2026-09-08T00:00:00.000Z', night), 'today');
  assert.equal(urgencyForDeadline('2026-09-08T21:00:00.000Z', night), 'tomorrow');
});

test('el conteo de vencidos reutiliza el criterio de bandeja y no cierra pedidos', async () => {
  const db = new InboxDb();
  const result = await countOpenOverdueOrders(db);
  assert.equal(result.count, 0);
  const sql = inboxSql(db, 'min(o.promised_shipping_at)');
  assert.match(sql, /America\/Lima/);
  assert.match(sql, /::date < /);
  assert.doesNotMatch(sql, /update orders/);
  assert.equal(db.queries.length, 1);
});

test('con Ripley apagado la bandeja no lista ni cuenta ese canal', async () => {
  const db = new InboxDb();
  const result = await listLogisticsInbox({ stage: 'pending' }, db, { ripleyEnabled: false });
  assert.equal(result.channels.ripley, false);
  assert.match(inboxSql(db, 'as pending_count'), /ch.code <> 'ripley'/);
  assert.match(inboxSql(db, 'fulfillment_status = any'), /ch.code <> 'ripley'/);
});

test('el filtro de vencidos no exige plazo futuro', async () => {
  const db = new InboxDb();
  await listLogisticsInbox({ stage: 'pending', urgency: 'overdue' }, db, { ripleyEnabled: true });
  const listSql = inboxSql(db, 'fulfillment_status = any');
  assert.match(listSql, /America\/Lima/);
  assert.match(listSql, /::date < /);
  assert.doesNotMatch(listSql, /promised_shipping_at < now\(\)/);
});

test('filtra por urgencia y expone conteos de prioridad', async () => {
  const db = new InboxDb();
  const result = await listLogisticsInbox({ stage: 'pending', urgency: 'today' }, db, { ripleyEnabled: true });
  assert.match(inboxSql(db, 'fulfillment_status = any'), /America\/Lima/);
  assert.deepEqual(result.counts.urgency, { overdue: 0, today: 0, tomorrow: 0, later: 0 });
  assert.equal(result.orders[0].urgency, 'later');
  assert.equal(result.orders[0].labelPrint, null);
  assert.throws(() => parseLogisticsInboxFilters({ urgency: 'ayer' }), /Prioridad/);
});

test('filtra por una fecha concreta de plazo', async () => {
  const db = new InboxDb();
  const result = await listLogisticsInbox({ stage: 'pending', deadline: '2026-09-08' }, db, { ripleyEnabled: true });
  assert.equal(parseLogisticsInboxFilters({ deadline: '2026-09-08' }).deadline, '2026-09-08');
  assert.match(inboxSql(db, 'fulfillment_status = any'), /::date = \$/);
  assert.match(inboxSql(db, 'group by 1'), /group by 1/);
  assert.deepEqual(result.counts.dates, [{ date: '2026-09-08', count: 2 }]);
  assert.throws(() => parseLogisticsInboxFilters({ deadline: '08-09' }), /Fecha/);
  assert.throws(() => parseLogisticsInboxFilters({ deadline: '2026-13-40' }), /Fecha/);
});

test('bloquea un lote que incluye Ripley antes de imprimir', async () => {
  let listedRipley = 0;
  const rows = [
    printRow({ id: 21, channel_code: 'falabella', channel_name: 'Falabella', external_order_id: 'F-21' }),
    printRow({ id: 22, channel_code: 'ripley', channel_name: 'Ripley', external_order_id: 'R-22' }),
  ];
  await assert.rejects(() => printLogisticsPack(
    { orderIds: [21, 22] },
    {
      db: new PrintDb(rows),
      getFalabellaLabel: async () => stubLabelPdf('FAL'),
      listRipleyLabels: async () => {
        listedRipley += 1;
        return { labels: [] };
      },
    },
  ), /La impresión de pedidos Ripley está deshabilitada/);
  assert.equal(listedRipley, 0);
});

test('un pedido Ripley no se imprime', async () => {
  await assert.rejects(
    () => printLogisticsPack(
      { orderIds: [32] },
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
      },
    ),
    (error) => {
      assert.equal(error.message, 'La impresión de pedidos Ripley está deshabilitada.');
      return true;
    },
  );
});

test('Ripley bloquea la impresión antes de generar etiquetas de otros canales', async () => {
  await assert.rejects(
    () => printLogisticsPack(
      { orderIds: [51, 52] },
      {
        db: new PrintDb([
          printRow({ id: 51, channel_code: 'falabella', channel_name: 'Falabella', external_order_id: 'F-51' }),
          printRow({ id: 52, channel_code: 'ripley', channel_name: 'Ripley', external_order_id: 'R-52' }),
        ]),
        getFalabellaLabel: async () => {
          throw new Error('no debe llamar a Falabella');
        },
        listRipleyLabels: async () => ({ labels: [{ document_id: 'doc-52', order_id: 'R-52' }] }),
        downloadRipleyLabels: async () => ({ labels_generated: (await stubLabelPdf('RIP')).base64 }),
      },
    ),
    (error) => {
      assert.equal(error.message, 'La impresión de pedidos Ripley está deshabilitada.');
      return true;
    },
  );
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

test('valida en Mirakl los shipments Ripley antes de dejar el pedido listo', async () => {
  const updates = [];
  const validated = [];
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
  let readCount = 0;
  const result = await scheduleRipleyInboxReady({
    id: 20,
    companyId: 7,
    externalOrderId: '7935614201-A',
    externalOrderNumber: '7935614201',
    ripleyApiKey: 'api-key',
    ripleyShopId: '4362',
    metadata: {},
    orderedAt: '2026-09-04T10:00:00.000Z',
  }, {}, {
    db,
    miraklClient: {
      listAllShipments: async () => {
        readCount += 1;
        return [{
          id: 'shipment-1',
          orderId: '7935614201-A',
          status: readCount === 1 ? 'SHIPPING' : 'READY_FOR_PICK_UP',
        }];
      },
      validateShipmentsReadyForPickup: async (ids) => {
        validated.push(ids);
        return { successIds: ids, errors: [] };
      },
    },
    enqueue: async (job) => {
      enqueued.push(job);
      return { enqueued: true };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.alreadyReady, false);
  assert.deepEqual(validated, [['shipment-1']]);
  assert.deepEqual(result.shipmentIds, ['shipment-1']);
  assert.match(JSON.stringify(updates[0].params[1]), /READY_FOR_PICK_UP/);
  assert.equal(enqueued[0].orderId, 20);
});

test('marcar listo de Ripley permanece deshabilitado', async () => {
  await assert.rejects(
    () => markLogisticsOrderReady({ orderId: 20 }),
    /confirmación de pedidos Ripley está deshabilitada/,
  );
});

test('un propio se marca entregado sin pasar por marketplace', async () => {
  const updates = [];
  const enqueued = [];
  const result = await markLogisticsOrderDelivered({ orderId: 44 }, {
    db: {
      async query(sql, params) {
        if (sql.includes('from orders o')) {
          return {
            rows: [{
              id: 44,
              company_id: 7,
              external_order_id: 'MAN-44',
              external_order_number: 'QNC-10010',
              fulfillment_status: 'pending',
              ordered_at: '2026-09-08T12:00:00.000Z',
              channel_code: 'manual',
            }],
          };
        }
        if (sql.includes('update orders')) {
          updates.push(params);
          return {
            rows: [{
              id: 44,
              company_id: 7,
              external_order_id: 'MAN-44',
              external_order_number: 'QNC-10010',
              fulfillment_status: 'delivered',
              ordered_at: '2026-09-08T12:00:00.000Z',
            }],
          };
        }
        return { rows: [] };
      },
    },
    enqueue: async (input) => {
      enqueued.push(input);
      return { enqueued: true };
    },
  });
  assert.deepEqual(result, { ok: true, alreadyDelivered: false, orderId: 44 });
  assert.equal(updates[0][0], 44);
  assert.equal(enqueued[0].orderId, 44);
  assert.equal(enqueued[0].source, 'user');

  await assert.rejects(
    () => markLogisticsOrderDelivered({ orderId: 20 }, {
      db: {
        async query() {
          return { rows: [{ id: 20, channel_code: 'falabella', fulfillment_status: 'pending' }] };
        },
      },
    }),
    /propios/,
  );
});

test('un propio ya entregado no se vuelve a marcar', async () => {
  const result = await markLogisticsOrderDelivered({ orderId: 45 }, {
    db: {
      async query() {
        return { rows: [{ id: 45, channel_code: 'manual', fulfillment_status: 'delivered' }] };
      },
    },
  });
  assert.deepEqual(result, { ok: true, alreadyDelivered: true, orderId: 45 });
});

test('un marketplace ya enviado no cuenta como vencido ni queda abierto', () => {
  assert.deepEqual(closedFalabellaFulfillment('shipped'), {
    orderStatus: 'confirmed',
    fulfillmentStatus: 'shipped',
  });
  assert.deepEqual(closedFalabellaFulfillment('delivered'), {
    orderStatus: 'completed',
    fulfillmentStatus: 'delivered',
  });
  assert.equal(closedFalabellaFulfillment('ready_to_ship'), null);
  assert.equal(closedFalabellaFulfillment('pending'), null);
});

test('restaura todos los padres Falabella que GetOrderItems había bajado a pending', async () => {
  const sql = [];
  const result = await alignFalabellaHeaderWithClosedFulfillment({
    async query(query) {
      sql.push(query.replace(/\s+/g, ' ').trim());
      return { rowCount: query.includes('update falabella_orders') ? 4 : 4, rows: [] };
    },
  });
  assert.equal(result.updated, 4);
  assert.match(sql[0], /update falabella_orders/);
  assert.match(sql[0], /fulfillment_status in \('shipped', 'delivered'\)/);
  assert.match(sql[1], /update falabella_order_lifecycle/);
});

test('saca de vencidos un Falabella con plazo vencido que GetOrder ya envió', async () => {
  const sql = [];
  const result = await closeOverdueFalabellaFulfillment({
    async query(query) {
      sql.push(query.replace(/\s+/g, ' ').trim());
      return { rowCount: query.includes('update orders') ? 7 : 7, rows: [] };
    },
  });
  assert.equal(result.updated, 7);
  assert.match(sql[0], /update orders/);
  assert.match(sql[0], /America\/Lima/);
  assert.match(sql[0], /fulfillment_status = 'shipped'/);
  assert.match(sql[1], /update falabella_orders/);
});

test('cierra en la bandeja un Falabella que el canal ya marcó enviado', async () => {
  const updates = [];
  const result = await closeStaleFalabellaFulfillment({
    async query(sql, params = []) {
      if (sql.includes('from orders o')) {
        return {
          rows: [{
            id: 88,
            fulfillment_status: 'ready_to_ship',
            provider_status: 'ready_to_ship',
            falabella_status: 'shipped',
          }],
        };
      }
      updates.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      return { rowCount: 1, rows: [] };
    },
  });
  assert.equal(result.updated, 1);
  assert.equal(updates[0].params[1], 'shipped');
  assert.equal(updates[0].params[0], 88);
});

test('cierra en la bandeja un Ripley ya shipped aunque siga pending local', async () => {
  const updates = [];
  const result = await closeStaleRipleyShippedFulfillment({
    async query(sql, params = []) {
      if (sql.includes('from orders o')) {
        return {
          rows: [{
            id: 91,
            provider_status: 'SHIPPED',
            fulfillment_status: 'pending',
            metadata: {},
          }],
        };
      }
      updates.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      return { rowCount: 1, rows: [] };
    },
  });
  assert.equal(result.updated, 1);
  assert.equal(updates[0].params[1], 'shipped');
});
