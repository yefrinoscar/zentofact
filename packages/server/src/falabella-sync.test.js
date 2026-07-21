import test from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveFalabellaItemStatus,
  fetchFalabellaPages,
  listLocalFalabellaOrders,
  normalizeFalabellaOrder,
  normalizeFalabellaStatus,
  syncFalabellaOrders,
} from './falabella-sync.js';

function response(orders, overrides = {}) {
  return {
    ok: true,
    status: 200,
    data: { orders },
    ...overrides,
  };
}

test('normaliza estados anidados de Falabella sin perder valores', () => {
  assert.equal(
    normalizeFalabellaStatus([{ Status: 'Ready_To_Ship' }, { Status: { Name: 'Delivered' } }]),
    'ready_to_ship|delivered',
  );
});

test('prioriza el estado operativo actual de los items de una orden', () => {
  assert.equal(effectiveFalabellaItemStatus([{ Status: 'shipped' }]), 'shipped');
  assert.equal(effectiveFalabellaItemStatus([{ Status: 'delivered' }, { Status: 'shipped' }]), 'shipped');
  assert.equal(effectiveFalabellaItemStatus([{ Status: 'shipped' }, { Status: 'ready_to_ship' }]), 'ready_to_ship');
  assert.equal(effectiveFalabellaItemStatus([{ Status: 'ready_to_ship' }, { Status: 'pending' }]), 'pending');
});

test('normaliza una orden y conserva el JSON original', () => {
  const raw = {
    OrderId: 99,
    OrderNumber: '  FAL-100  ',
    CreatedAt: '2026-07-01T10:00:00Z',
    UpdatedAt: '2026-07-02T11:00:00Z',
    GrandTotal: '1,234.50',
    InvoiceRequired: '1',
    Statuses: [{ Status: 'shipped' }],
  };
  const normalized = normalizeFalabellaOrder(raw);
  assert.equal(normalized.orderId, '99');
  assert.equal(normalized.orderNumber, 'FAL-100');
  assert.equal(normalized.grandTotal, 1234.5);
  assert.equal(normalized.invoiceRequired, true);
  assert.equal(normalized.status, 'shipped');
  assert.equal(normalized.raw, raw);
});

test('pagina hasta recibir una página incompleta y usa offsets correctos', async () => {
  const calls = [];
  const client = {
    async getOrdersV2(filters) {
      calls.push(filters);
      return response(filters.offset === 0
        ? [{ OrderId: 1 }, { OrderId: 2 }]
        : [{ OrderId: 3 }]);
    },
  };
  const seen = [];
  const result = await fetchFalabellaPages(client, { updatedAfter: '2026-07-01T00:00:00Z' }, async (orders) => {
    seen.push(...orders);
  }, 2);
  assert.deepEqual(calls.map((call) => call.offset), [0, 2]);
  assert.deepEqual(calls.map((call) => call.limit), [2, 2]);
  assert.equal(result.pages, 2);
  assert.equal(result.received, 3);
  assert.equal(seen.length, 3);
});

test('detiene la sincronización ante un error funcional de Falabella', async () => {
  const client = {
    async getOrdersV2() {
      return response([], {
        data: { ErrorResponse: { Head: { ErrorCode: 'E42', ErrorMessage: 'Temporalmente no disponible' } } },
      });
    },
  };
  await assert.rejects(
    fetchFalabellaPages(client, { updatedAfter: '2026-07-01T00:00:00Z' }, async () => {}),
    /Temporalmente no disponible/,
  );
});

class FakeDb {
  constructor({ locked = true } = {}) {
    this.locked = locked;
    this.queries = [];
    this.released = false;
    this.state = {
      company_id: 7,
      enabled: true,
      status: 'pending',
      full_sync_completed: false,
      cursor_updated_at: '2026-07-10T10:00:00Z',
      sync_interval_minutes: 10,
    };
  }

  async query(sql, params = []) {
    const compact = sql.replace(/\s+/g, ' ').trim();
    this.queries.push({ sql: compact, params });
    if (compact.startsWith('select pg_try_advisory_lock')) return { rows: [{ locked: this.locked }] };
    if (compact.startsWith('select * from falabella_sync_state')) return { rows: [this.state] };
    if (compact.startsWith('insert into falabella_sync_runs')) return { rows: [{ id: 55 }] };
    if (compact.startsWith('select company_id, enabled, status')) return { rows: [this.state] };
    return { rows: [] };
  }

  release() { this.released = true; }
}

function fakeDependencies(db, client) {
  return {
    pool: { connect: async () => db },
    getCompany: async () => ({
      id: 7,
      activo: true,
      falabellaApiUserId: 'seller',
      falabellaApiKey: 'secret',
    }),
    clientFor: () => client,
  };
}

test('no avanza el cursor cuando Falabella falla', async () => {
  const db = new FakeDb();
  const client = { getOrdersV2: async () => { throw new Error('timeout externo'); } };
  await assert.rejects(
    syncFalabellaOrders(7, { now: '2026-07-10T11:00:00Z' }, fakeDependencies(db, client)),
    /timeout externo/,
  );
  assert.equal(db.queries.some((query) => query.sql.includes("set status='error'")), true);
  assert.equal(db.queries.some((query) => query.sql.includes('cursor_updated_at=case')), false);
  assert.equal(db.released, true);
});

test('una sincronización mensual guarda órdenes y registra cobertura del mes', async () => {
  const db = new FakeDb();
  const client = {
    getOrdersV2: async () => response([{
      OrderId: '10', OrderNumber: 'ORD-10', CreatedAt: '2026-07-03T10:00:00Z',
      UpdatedAt: '2026-07-03T10:05:00Z', GrandTotal: 50, Statuses: [{ Status: 'pending' }],
    }]),
  };
  const result = await syncFalabellaOrders(7, { mode: 'month', month: '2026-07' }, fakeDependencies(db, client));
  assert.equal(result.status, 'success');
  assert.equal(result.received, 1);
  assert.equal(db.queries.some((query) => query.sql.startsWith('insert into falabella_orders')), true);
  const lifecycle = db.queries.find((query) => query.sql.startsWith('insert into falabella_order_lifecycle'));
  assert.equal(lifecycle.params[3], 'pending');
  assert.equal(lifecycle.params[4], '2026-07-03T10:00:00.000Z');
  const coverage = db.queries.find((query) => query.sql.startsWith('insert into falabella_sync_windows'));
  assert.deepEqual(coverage.params.slice(0, 2), [7, '2026-07']);
  assert.equal(db.queries.some((query) => query.sql.includes('cursor_updated_at=case') && query.params[4] === 'month'), true);
});

test('rechaza una segunda sincronización de la misma empresa sin llamar Falabella', async () => {
  const db = new FakeDb({ locked: false });
  let called = false;
  const result = await syncFalabellaOrders(7, {}, fakeDependencies(db, {
    getOrdersV2: async () => { called = true; return response([]); },
  }));
  assert.equal(result.status, 'already_running');
  assert.equal(called, false);
  assert.equal(db.released, true);
});

test('la lectura local resuelve documentos en una sola consulta SQL', async () => {
  const queries = [];
  const db = {
    async query(sql) {
      const compact = sql.replace(/\s+/g, ' ').trim();
      queries.push(compact);
      if (compact.startsWith('select fo.order_number')) {
        return { rows: [{
          order_number: 'ORD-LOCAL',
          raw_data: { OrderId: '1', OrderNumber: 'ORD-LOCAL' },
          boleta_id: 8,
          boleta_numero: 'B001-8',
          boleta_fecha: '2026-07-03',
          boleta_estado: 'ACEPTADO',
          boleta_xml: 'boletas/xml/B001-8.xml',
          boleta_cdr: 'boletas/cdr/R-B001-8.zip',
          boleta_datos_adicionales: {
            falabellaPdfUpload: { uploadedAt: '2026-07-03T12:30:00.000Z' },
          },
          total_count: 1,
        }] };
      }
      if (compact.startsWith('select last_successful_sync_at')) {
        return { rows: [{ last_successful_sync_at: '2026-07-13T10:00:00Z', orders_received: 1 }] };
      }
      if (compact.startsWith('select company_id, enabled, status')) return { rows: [] };
      return { rows: [] };
    },
  };
  const result = await listLocalFalabellaOrders(7, {
    createdAfter: '2026-07-01T00:00:00Z',
    createdBefore: '2026-07-31T23:59:59Z',
  }, db);
  assert.equal(result.source, 'postgres');
  assert.equal(result.totalCount, 1);
  assert.equal(result.orders[0].__resolved.boleta.numeroCompleto, 'B001-8');
  assert.equal(result.orders[0].__resolved.boleta.canUploadPdf, true);
  assert.equal(result.orders[0].__resolved.boleta.falabellaPdfUploadedAt, '2026-07-03T12:30:00.000Z');
  assert.equal(queries.filter((query) => query.includes('from falabella_orders')).length, 1);
  assert.equal(queries.some((query) => query.includes('left join lateral')), true);
  assert.equal(queries.some((query) => query.includes('boleta_datos_adicionales')), true);
});
