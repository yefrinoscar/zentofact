import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commissionShare,
  listSalespersonEarningSales,
  listSalespersonEarnings,
  parseEarningsFilters,
  parseEarningsRange,
  summarizeEarnings,
} from './salesperson-earnings.js';

function compact(sql) {
  return String(sql || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function personRow(overrides = {}) {
  return {
    id: 'u1', name: 'Ana', email: 'ana@x.pe', active: true, commission_percent: '5',
    orders_count: 2, units: '3', sales_total: '300', commission: '30', paid_commission: '20',
    percent_orders: 0, incomplete_orders: 0, lines_without_commission: 0, other_currency_orders: 0,
    last_sale_at: '2026-10-12T15:00:00Z', total_count: 1,
    ...overrides,
  };
}

test('el periodo por defecto es el mes en curso de Lima', () => {
  assert.deepEqual(parseEarningsRange({}, '2026-11-02'), { from: '2026-11-01', to: '2026-11-02' });
  const filters = parseEarningsFilters({}, '2026-11-02');
  assert.equal(filters.sortBy, 'commission');
  assert.equal(filters.sortDir, 'desc');
  assert.equal(filters.limit, 20);
  assert.equal(parseEarningsFilters({ sortBy: 'name' }, '2026-11-02').sortDir, 'asc');
  assert.equal(parseEarningsFilters({ limit: '500' }, '2026-11-02').limit, 100);
});

test('el periodo rechaza fechas inválidas, invertidas o de más de un año', () => {
  assert.throws(() => parseEarningsRange({ from: '2026-02-30', to: '2026-03-01' }), /Fecha inicial inválida/);
  assert.throws(() => parseEarningsRange({ from: '2026-03-02', to: '2026-03-01' }), /anterior a la final/);
  assert.throws(() => parseEarningsRange({ from: '2025-01-01', to: '2026-03-01' }), /hasta un año/);
  assert.throws(() => parseEarningsFilters({ sortBy: 'profit' }), /sortBy inválido/);
  assert.throws(() => parseEarningsFilters({ sortDir: 'sideways' }), /sortDir inválido/);
  assert.equal(parseEarningsRange({ from: '2026-01-01', to: '2026-12-31' }).to, '2026-12-31');
});

test('el % de la venta no se inventa sin ventas', () => {
  assert.equal(commissionShare(0, 0), null);
  assert.equal(commissionShare(15, 300), 0.05);
});

test('los totales suman todos los vendedores visibles, no solo la página', () => {
  const totals = summarizeEarnings([
    { ordersCount: 2, unitsSold: 3, salesTotal: 300, commission: 30, paidCommission: 20, incompleteOrders: 1, linesWithoutCommission: 2, percentOrders: 0, otherCurrencyOrders: 0 },
    { ordersCount: 0, unitsSold: 0, salesTotal: 0, commission: 0, paidCommission: 0, incompleteOrders: 0, linesWithoutCommission: 0, percentOrders: 0, otherCurrencyOrders: 1 },
  ]);
  assert.equal(totals.salespeople, 2);
  assert.equal(totals.withSales, 1);
  assert.equal(totals.salesTotal, 300);
  assert.equal(totals.commission, 30);
  assert.equal(totals.commissionShare, 0.1);
  assert.equal(totals.incompleteOrders, 1);
  assert.equal(totals.otherCurrencyOrders, 1);
});

test('la consulta agrega en servidor solo ventas válidas en soles de usuarios vendedor', async () => {
  const calls = [];
  const db = {
    query: async (sql, params) => {
      calls.push({ sql: compact(sql), params });
      if (sql.includes('limit $')) return { rows: [personRow()] };
      return {
        rows: [
          personRow(),
          personRow({ id: 'u2', name: 'Beto', orders_count: 1, sales_total: '100', commission: '0', paid_commission: '0', incomplete_orders: 1, lines_without_commission: 2 }),
        ],
      };
    },
  };
  const result = await listSalespersonEarnings({ from: '2026-10-01', to: '2026-10-31', search: 'an', limit: 1 }, db);
  assert.equal(calls.length, 2);
  const page = calls.find((call) => call.sql.includes('limit $'));
  assert.deepEqual(page.params, ['2026-10-01', '2026-10-31', 'an', 1, 0]);
  for (const fragment of [
    "r.role = 'vendedor'",
    "o.currency = 'pen'",
    "o.order_status not in ('cancelled', 'failed')",
    "o.payment_status not in ('refunded', 'failed')",
    "o.fulfillment_status not in ('cancelled', 'returned', 'failed')",
    "at time zone 'america/lima')::date between $1::date and $2::date",
    'join salespeople s on s.id = o.created_by',
    'order by p.commission desc nulls last',
  ]) {
    assert.ok(page.sql.includes(fragment), `falta ${fragment}`);
  }
  assert.equal(result.salespeople.length, 1);
  assert.equal(result.salespeople[0].commissionShare, 0.1);
  assert.equal(result.salespeople[0].averageTicket, 150);
  assert.equal(result.totalCount, 1);
  assert.equal(result.totals.salesTotal, 400);
  assert.equal(result.totals.commission, 30);
  assert.equal(result.totals.incompleteOrders, 1);
  assert.equal(result.totals.linesWithoutCommission, 2);
});

test('el detalle exige un usuario vendedor y devuelve la regla de cada pedido', async () => {
  const missing = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    listSalespersonEarningSales('admin-1', { from: '2026-10-01', to: '2026-10-31' }, missing),
    (error) => error.status === 404,
  );

  const calls = [];
  const db = {
    query: async (sql, params) => {
      calls.push({ sql: compact(sql), params });
      if (calls.length === 1) return { rows: [{ id: 'u1', name: 'Ana', email: 'ana@x.pe', active: false, commission_percent: '0' }] };
      return {
        rows: [{
          id: '7', external_order_number: 'VTA-1', sold_at: '2026-10-12T15:00:00Z', customer_name: 'Luz',
          total: '120', commission: '10', commission_rule: 'partial', lines_count: 2, priced_lines: 1,
          payment_status: 'pending', fulfillment_status: 'delivered', units: '3',
          items: [{ name: 'Manta', sku: 'AG301', quantity: 2, unitCommission: 5 }, { name: 'Bolso', sku: 'HOG025', quantity: 1, unitCommission: null }],
          total_count: 1,
        }],
      };
    },
  };
  const result = await listSalespersonEarningSales('u1', { from: '2026-10-01', to: '2026-10-31' }, db);
  assert.equal(calls[1].sql.includes('and o.created_by = $1'), true);
  assert.deepEqual(calls[1].params, ['u1', '2026-10-01', '2026-10-31', 20, 0]);
  assert.equal(result.salesperson.active, false);
  assert.equal(result.sales[0].commissionRule, 'partial');
  assert.equal(result.sales[0].linesWithoutCommission, 1);
  assert.equal(result.sales[0].items[1].unitCommission, null);
});
