import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryCycleWindows, listFalabellaInboxCompanies, listOrdersInbox, parseOrdersInboxFilters, syncAllOrdersInbox } from './orders-inbox.js';

test('normaliza filtros seguros para la bandeja', () => {
  assert.deepEqual(parseOrdersInboxFilters({
    companyId: '7', stage: 'por_emitir', view: 'all', days: '30', search: '  ORD-10  ', limit: '25', offset: '50',
  }), {
    companyId: 7,
    stage: 'por_emitir',
    view: 'all',
    days: 30,
    search: 'ORD-10',
    limit: 25,
    offset: 50,
  });
});

test('rechaza etapas y periodos desconocidos', () => {
  assert.throws(() => parseOrdersInboxFilters({ stage: 'inventada' }), /Etapa/);
  assert.throws(() => parseOrdersInboxFilters({ days: 365 }), /Periodo/);
});

test('acepta la vista operativa y permite cargar el tablero completo', () => {
  const filters = parseOrdersInboxFilters({ view: 'actionable', limit: 500 });
  assert.equal(filters.view, 'actionable');
  assert.equal(filters.limit, 500);
});

test('calcula los turnos de 5pm a mediodía y de mediodía a 5pm en Lima', () => {
  const evening = deliveryCycleWindows('2026-07-16T04:00:00Z');
  assert.deepEqual(evening, [
    { key: 'evening_to_noon', from: '2026-07-15T22:00:00.000Z', to: '2026-07-16T17:00:00.000Z', state: 'active' },
    { key: 'noon_to_evening', from: '2026-07-16T17:00:00.000Z', to: '2026-07-16T22:00:00.000Z', state: 'upcoming' },
  ]);
  const afternoon = deliveryCycleWindows('2026-07-16T18:00:00Z');
  assert.equal(afternoon[0].state, 'completed');
  assert.equal(afternoon[1].state, 'active');
  const exactNoon = deliveryCycleWindows('2026-07-16T17:00:00Z');
  assert.equal(exactNoon[0].state, 'completed');
  assert.equal(exactNoon[1].state, 'active');
});

test('consolida pedidos, métricas y tiendas en una respuesta', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      const compact = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: compact, params });
      if (compact.includes('select *, count(*) over()')) return { rows: [{
        id: '12', company_id: 7, company_name: 'Tienda Centro', company_ruc: '20123456789',
        order_id: '900', order_number: 'ORD-900', falabella_created_at: '2026-07-14T10:00:00Z',
        falabella_updated_at: '2026-07-14T10:02:00Z', first_seen_at: '2026-07-14T10:03:00Z',
        promised_shipping_time: '2026-07-15 21:00:00', shipping_type: 'Dropshipping',
        falabella_status: 'ready_to_ship', invoice_required: false, grand_total: '149.90', currency: 'PEN',
        customer_name: 'Ana Pérez', items_count: '2', stage: 'por_emitir', document_id: null, total_count: 4, shipped_count: 3,
      }] };
      if (compact.includes('min(last_successful_sync_at)')) return { rows: [{ last_synced_at: '2026-07-14T10:05:00Z' }] };
      if (compact.includes('generate_series')) return { rows: [{
        cycle_date: '2026-07-15', window_key: 'evening_to_noon', deliveries: 0,
        preparation_measured: 0, preparation_avg: null, preparation_min: null, preparation_max: null,
        handoff_measured: 0, handoff_avg: null, handoff_min: null, handoff_max: null,
        total_measured: 0, total_avg: null, total_min: null, total_max: null,
      }, {
        cycle_date: '2026-07-15', window_key: 'noon_to_evening', deliveries: 0,
        preparation_measured: 0, preparation_avg: null, preparation_min: null, preparation_max: null,
        handoff_measured: 0, handoff_avg: null, handoff_min: null, handoff_max: null,
        total_measured: 0, total_avg: null, total_min: null, total_max: null,
      }, {
        cycle_date: '2026-07-16', window_key: 'evening_to_noon', deliveries: 3,
        preparation_measured: 3, preparation_avg: 32, preparation_min: 12, preparation_max: 50,
        handoff_measured: 3, handoff_avg: 13, handoff_min: 5, handoff_max: 22,
        total_measured: 3, total_avg: 45, total_min: 22, total_max: 70,
      }, {
        cycle_date: '2026-07-16', window_key: 'noon_to_evening', deliveries: 2,
        preparation_measured: 2, preparation_avg: 40, preparation_min: 30, preparation_max: 61,
        handoff_measured: 1, handoff_avg: 20, handoff_min: 20, handoff_max: 20,
        total_measured: 2, total_avg: 58, total_min: 40, total_max: 80,
      }] };
      if (compact.includes('from falabella_order_lifecycle')) return { rows: [{
        window_key: 'evening_to_noon', deliveries: 3,
        preparation_measured: 3, preparation_avg: 42, preparation_min: 20, preparation_max: 70,
        handoff_measured: 2, handoff_avg: 18, handoff_min: 10, handoff_max: 26,
        total_measured: 3, total_avg: 60, total_min: 35, total_max: 88,
      }] };
      if (compact.includes('group by company_id, company_name')) return { rows: [{
        company_id: 7, company_name: 'Tienda Centro', total: 4, open: 3, open_amount: '399.80',
      }] };
      if (compact.includes('count(*) filter (where stage')) return { rows: [{
        total: 4, open: 3, new: 1, ready: 1, processing: 0, attention: 1, completed: 1, open_amount: '399.80',
      }] };
      throw new Error(`Consulta inesperada: ${compact}`);
    },
  };

  const result = await listOrdersInbox({ companyId: 7, stage: 'por_emitir', view: 'actionable' }, db);
  assert.equal(result.orders[0].orderNumber, 'ORD-900');
  assert.equal(result.orders[0].stage, 'por_emitir');
  assert.equal(result.orders[0].total, 149.9);
  assert.equal(result.orders[0].promisedShippingAt, '2026-07-15T21:00:00.000Z');
  assert.equal(result.summary.open, 3);
  assert.equal(result.summary.byCompany[0].companyName, 'Tienda Centro');
  assert.equal(result.totalCount, 4);
  assert.equal(result.shippedCount, 3);
  assert.equal(result.operationalCount, 1);
  assert.equal(result.deliveryMetrics.windows[0].deliveries, 3);
  assert.equal(result.deliveryMetrics.windows[0].handoff.averageMinutes, 18);
  assert.equal(result.deliveryMetrics.windows[1].deliveries, 0);
  assert.equal(result.deliveryMetrics.days[0].date, '2026-07-15');
  assert.equal(result.deliveryMetrics.days[0].windows.length, 2);
  assert.deepEqual(result.deliveryMetrics.days[1], {
    date: '2026-07-16',
    windows: [{
      key: 'evening_to_noon',
      deliveries: 3,
      preparation: { measured: 3, averageMinutes: 32, minMinutes: 12, maxMinutes: 50 },
      handoff: { measured: 3, averageMinutes: 13, minMinutes: 5, maxMinutes: 22 },
      total: { measured: 3, averageMinutes: 45, minMinutes: 22, maxMinutes: 70 },
    }, {
      key: 'noon_to_evening',
      deliveries: 2,
      preparation: { measured: 2, averageMinutes: 40, minMinutes: 30, maxMinutes: 61 },
      handoff: { measured: 1, averageMinutes: 20, minMinutes: 20, maxMinutes: 20 },
      total: { measured: 2, averageMinutes: 58, minMinutes: 40, maxMinutes: 80 },
    }],
  });
  assert.equal(calls.find((call) => call.sql.includes('select *, count(*) over()')).params[3], 'actionable');
  assert.equal(calls.find((call) => call.sql.includes('select *, count(*) over()')).params[4], 'por_emitir');
  assert.match(calls.find((call) => call.sql.includes('select *, count(*) over()')).sql, /pending\|ready_to_ship\|shipped/);
  assert.match(calls.find((call) => call.sql.includes('shipped_at_utc >=')).sql, /shipped_at \+ interval '5 hours'/);
  assert.match(calls.find((call) => call.sql.includes('generate_series')).sql, /time '17:00'/);
  assert.match(calls.find((call) => call.sql.includes('generate_series')).sql, /cross join shift_windows/);
});

test('sincroniza solo tiendas activas con credenciales y conserva errores por tienda', async () => {
  const seen = [];
  const result = await syncAllOrdersInbox({
    listCompanies: async () => [
      { id: 1, activo: true, nombre: 'Uno', falabellaApiUserId: 'user', falabellaApiKey: 'key' },
      { id: 2, activo: true, nombre: 'Dos', falabellaApiUserId: 'user', falabellaApiKey: 'key' },
      { id: 3, activo: false, nombre: 'Tres', falabellaApiUserId: 'user', falabellaApiKey: 'key' },
    ],
    syncOrders: async (companyId) => {
      seen.push(companyId);
      if (companyId === 2) throw new Error('temporal');
      return { status: 'success' };
    },
  });
  assert.deepEqual(seen, [1, 2]);
  assert.equal(result.stores, 2);
  assert.equal(result.successful, 1);
  assert.equal(result.failed, 1);
});

test('lista todas las tiendas Falabella aunque no tengan pedidos pendientes', async () => {
  const result = await listFalabellaInboxCompanies({
    listPublicCompanies: async () => [
      { id: 1, nombre: 'Higher', activo: true, hasFalabellaCredentials: true },
      { id: 2, nombre: 'Runapuma', activo: true, hasFalabellaCredentials: true },
      { id: 3, nombre: 'Sin API', activo: true, hasFalabellaCredentials: false },
      { id: 4, nombre: 'Inactiva', activo: false, hasFalabellaCredentials: true },
    ],
  });

  assert.deepEqual(result, [
    { id: 1, name: 'Higher' },
    { id: 2, name: 'Runapuma' },
  ]);
});
