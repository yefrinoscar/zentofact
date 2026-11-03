// Ganancias de vendedores: la comisión que ganó cada usuario con perfil
// Vendedor por los Pedidos que registró. Usa exactamente la misma regla de
// comisión y las mismas exclusiones que "Mis ventas", para que el monto que ve
// el administrador coincida con el que ve cada vendedor.
//
// No es utilidad del negocio: el catálogo no guarda costo de compra, así que
// aquí no se descuentan costos de producto, envío ni cobros del canal.
import { SALES_EXCLUSIONS, SALESPERSON_COMMISSION_SQL } from './order-management.js';

export const EARNINGS_CURRENCY = 'PEN';
export const EARNINGS_SORT_FIELDS = ['commission', 'salesTotal', 'orders', 'commissionShare', 'name'];
export const COMMISSION_RULES = ['catalog', 'percent', 'partial', 'missing'];
const MAX_RANGE_DAYS = 366;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

let corePromise;
function loadCore() {
  corePromise ||= import('@zentofact/core');
  return corePromise;
}

function inputError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function limaDateKey(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(value);
}

function isDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

function boundedInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.trunc(number), min), max);
}

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** Periodo en días calendario de Lima. Por defecto, el mes en curso. */
export function parseEarningsRange(input = {}, today = limaDateKey()) {
  const from = String(input.from || '').trim() || `${today.slice(0, 7)}-01`;
  const to = String(input.to || '').trim() || today;
  if (!isDateKey(from)) throw inputError('Fecha inicial inválida.');
  if (!isDateKey(to)) throw inputError('Fecha final inválida.');
  if (from > to) throw inputError('La fecha inicial debe ser anterior a la final.');
  if (daysBetween(from, to) > MAX_RANGE_DAYS) throw inputError('Elige un periodo de hasta un año.');
  return { from, to };
}

export function parseEarningsFilters(input = {}, today) {
  const { from, to } = parseEarningsRange(input, today);
  const sortBy = String(input.sortBy || '').trim() || 'commission';
  if (!EARNINGS_SORT_FIELDS.includes(sortBy)) throw inputError('sortBy inválido.');
  const rawDir = String(input.sortDir || '').trim().toLowerCase();
  if (rawDir && rawDir !== 'asc' && rawDir !== 'desc') throw inputError('sortDir inválido.');
  const sortDir = rawDir || (sortBy === 'name' ? 'asc' : 'desc');
  return {
    from,
    to,
    search: String(input.search || '').trim().slice(0, 120),
    sortBy,
    sortDir,
    limit: boundedInt(input.limit, DEFAULT_LIMIT, 1, MAX_LIMIT),
    offset: boundedInt(input.offset, 0, 0, 1_000_000),
  };
}

export function commissionShare(commission, salesTotal) {
  const sales = Number(salesTotal) || 0;
  if (sales <= 0) return null;
  return (Number(commission) || 0) / sales;
}

const SORT_SQL = {
  commission: 'p.commission',
  salesTotal: 'p.sales_total',
  orders: 'p.orders_count',
  commissionShare: 'p.commission / nullif(p.sales_total, 0)',
  name: 'lower(p.name)',
};

// Mismo criterio que listActiveSalespeople, pero incluye inactivos: un
// vendedor dado de baja conserva la comisión de lo que vendió en el periodo.
const SALESPEOPLE_SQL = `
  select u.id, coalesce(nullif(trim(u.name), ''), u.email, u.id) as name, u.email,
    coalesce(u.active, true) as active,
    coalesce(u.commission_percent, 0)::numeric as commission_percent
  from "user" u
  where (
    exists (select 1 from user_roles r where r.user_id = u.id and r.role = 'vendedor')
    or (u.role = 'vendedor' and not exists (select 1 from user_roles r where r.user_id = u.id))
  )`;

const ORDER_DATE_SQL = `(coalesce(o.ordered_at, o.created_at) at time zone 'America/Lima')::date`;

// Regla de comisión por Pedido, con la misma precedencia que SALESPERSON_COMMISSION_SQL:
// catalog = todas las líneas tienen comisión (corregida en la línea o del Producto);
// partial = algunas líneas no la tienen y suman 0; percent = ninguna la tiene y se
// usa el % del vendedor; missing = no hay ninguna comisión y el Pedido suma 0.
// Una fila por Pedido vendido en soles dentro del periodo. `lines` cuenta las
// líneas que SALESPERSON_COMMISSION_SQL sí suma (Producto enlazado con comisión).
function salesCte({ fromParam, toParam, userParam = null }) {
  return `
  salespeople as (${SALESPEOPLE_SQL}),
  sales as (
    select o.id, o.created_by, o.payment_status,
      coalesce(o.total, 0)::numeric as total,
      coalesce(o.ordered_at, o.created_at) as sold_at,
      (${SALESPERSON_COMMISSION_SQL})::numeric as commission,
      lines.lines_count, lines.priced_lines, lines.units,
      case
        when lines.priced_lines > 0 and lines.priced_lines < lines.lines_count then 'partial'
        when lines.priced_lines > 0 then 'catalog'
        when s.commission_percent > 0 then 'percent'
        else 'missing'
      end as commission_rule
    from orders o
    join salespeople s on s.id = o.created_by
    cross join lateral (
      select count(*)::int as lines_count,
        count(*) filter (
          where p.id is not null and coalesce(oi.commission_amount, p.commission_amount) is not null
        )::int as priced_lines,
        coalesce(sum(oi.quantity), 0)::numeric as units
      from order_items oi
      left join products p on p.id = oi.product_id
      where oi.order_id = o.id
    ) lines
    where ${SALES_EXCLUSIONS}
      and o.currency = '${EARNINGS_CURRENCY}'
      and ${ORDER_DATE_SQL} between ${fromParam}::date and ${toParam}::date
      ${userParam ? `and o.created_by = ${userParam}` : ''}
  )`;
}

function normalizeSalespersonRow(row) {
  const salesTotal = money(row.sales_total);
  const commission = money(row.commission);
  return {
    userId: String(row.id),
    name: String(row.name || '').trim() || 'Vendedor sin nombre',
    email: row.email || null,
    active: row.active !== false,
    commissionPercent: Number(row.commission_percent) || 0,
    ordersCount: Number(row.orders_count) || 0,
    unitsSold: Number(row.units) || 0,
    salesTotal,
    commission,
    paidCommission: money(row.paid_commission),
    commissionShare: commissionShare(commission, salesTotal),
    averageTicket: Number(row.orders_count) > 0 ? money(salesTotal / Number(row.orders_count)) : null,
    percentOrders: Number(row.percent_orders) || 0,
    incompleteOrders: Number(row.incomplete_orders) || 0,
    linesWithoutCommission: Number(row.lines_without_commission) || 0,
    otherCurrencyOrders: Number(row.other_currency_orders) || 0,
    lastSaleAt: row.last_sale_at ? new Date(row.last_sale_at).toISOString() : null,
  };
}

export function summarizeEarnings(rows = []) {
  const totals = rows.reduce((acc, row) => ({
    salespeople: acc.salespeople + 1,
    withSales: acc.withSales + (row.ordersCount > 0 ? 1 : 0),
    ordersCount: acc.ordersCount + row.ordersCount,
    unitsSold: acc.unitsSold + row.unitsSold,
    salesTotal: acc.salesTotal + row.salesTotal,
    commission: acc.commission + row.commission,
    paidCommission: acc.paidCommission + row.paidCommission,
    incompleteOrders: acc.incompleteOrders + row.incompleteOrders,
    linesWithoutCommission: acc.linesWithoutCommission + row.linesWithoutCommission,
    percentOrders: acc.percentOrders + row.percentOrders,
    otherCurrencyOrders: acc.otherCurrencyOrders + row.otherCurrencyOrders,
  }), {
    salespeople: 0, withSales: 0, ordersCount: 0, unitsSold: 0, salesTotal: 0, commission: 0,
    paidCommission: 0, incompleteOrders: 0, linesWithoutCommission: 0, percentOrders: 0, otherCurrencyOrders: 0,
  });
  return {
    ...totals,
    salesTotal: money(totals.salesTotal),
    commission: money(totals.commission),
    paidCommission: money(totals.paidCommission),
    commissionShare: commissionShare(totals.commission, totals.salesTotal),
  };
}

/**
 * Una fila por vendedor con ventas, comisión y avisos de comisión incompleta.
 * Muestra a todo vendedor activo (aunque no venda) y a los inactivos con ventas.
 */
export async function listSalespersonEarnings(input = {}, db) {
  const target = db || (await loadCore()).pool;
  const filters = parseEarningsFilters(input);
  const values = [filters.from, filters.to];
  let searchSql = '';
  if (filters.search) {
    values.push(filters.search);
    searchSql = `and (p.name ilike '%' || $${values.length} || '%' or coalesce(p.email, '') ilike '%' || $${values.length} || '%')`;
  }
  const baseSql = `
    with ${salesCte({ fromParam: '$1', toParam: '$2' })},
    other_currency as (
      select o.created_by, count(*)::int as orders_count
      from orders o
      join salespeople s on s.id = o.created_by
      where ${SALES_EXCLUSIONS}
        and o.currency <> '${EARNINGS_CURRENCY}'
        and ${ORDER_DATE_SQL} between $1::date and $2::date
      group by o.created_by
    ),
    per_person as (
      select s.id, s.name, s.email, s.active, s.commission_percent,
        count(sa.id)::int as orders_count,
        coalesce(sum(sa.units), 0)::numeric as units,
        coalesce(sum(sa.total), 0)::numeric as sales_total,
        coalesce(sum(sa.commission), 0)::numeric as commission,
        coalesce(sum(sa.commission) filter (where sa.payment_status = 'paid'), 0)::numeric as paid_commission,
        count(sa.id) filter (where sa.commission_rule = 'percent')::int as percent_orders,
        count(sa.id) filter (where sa.commission_rule in ('partial', 'missing'))::int as incomplete_orders,
        coalesce(sum(sa.lines_count - sa.priced_lines)
          filter (where sa.commission_rule in ('partial', 'missing')), 0)::int as lines_without_commission,
        max(sa.sold_at) as last_sale_at,
        coalesce(max(oc.orders_count), 0)::int as other_currency_orders
      from salespeople s
      left join sales sa on sa.created_by = s.id
      left join other_currency oc on oc.created_by = s.id
      group by s.id, s.name, s.email, s.active, s.commission_percent
    ),
    visible as (
      select p.* from per_person p
      where (p.active or p.orders_count > 0 or p.other_currency_orders > 0)
      ${searchSql}
    )`;
  const direction = filters.sortDir === 'asc' ? 'asc' : 'desc';
  const nulls = direction === 'asc' ? 'nulls first' : 'nulls last';
  const pageValues = [...values, filters.limit, filters.offset];
  const [page, all] = await Promise.all([
    target.query(
      `${baseSql}
       select p.*, count(*) over()::int as total_count
       from visible p
       order by ${SORT_SQL[filters.sortBy]} ${direction} ${nulls}, lower(p.name) asc, p.id asc
       limit $${pageValues.length - 1} offset $${pageValues.length}`,
      pageValues,
    ),
    target.query(`${baseSql} select p.* from visible p`, values),
  ]);
  return {
    range: { from: filters.from, to: filters.to },
    currency: EARNINGS_CURRENCY,
    salespeople: page.rows.map(normalizeSalespersonRow),
    totals: summarizeEarnings(all.rows.map(normalizeSalespersonRow)),
    totalCount: Number(page.rows[0]?.total_count ?? all.rows.length) || 0,
    limit: filters.limit,
    offset: filters.offset,
    sortBy: filters.sortBy,
    sortDir: filters.sortDir,
  };
}

function normalizeSaleItems(value) {
  const list = Array.isArray(value) ? value : (() => {
    try { return JSON.parse(value || '[]'); } catch { return []; }
  })();
  return list.map((item) => ({
    name: String(item?.name || '').trim() || 'Producto sin nombre',
    sku: item?.sku ? String(item.sku) : null,
    quantity: Number(item?.quantity) || 0,
    unitCommission: item?.unitCommission == null ? null : Number(item.unitCommission),
  }));
}

/** Ventas de un vendedor en el periodo, con la comisión y la regla de cada Pedido. */
export async function listSalespersonEarningSales(userId, input = {}, db) {
  const target = db || (await loadCore()).pool;
  const id = String(userId || '').trim();
  if (!id || id.length > 300) throw inputError('Vendedor inválido.');
  const { from, to } = parseEarningsRange(input);
  const limit = boundedInt(input.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = boundedInt(input.offset, 0, 0, 1_000_000);
  const person = await target.query(`${SALESPEOPLE_SQL} and u.id = $1`, [id]);
  if (!person.rows[0]) {
    throw Object.assign(new Error('Vendedor no encontrado.'), { status: 404 });
  }
  const result = await target.query(
    `with ${salesCte({ fromParam: '$2', toParam: '$3', userParam: '$1' })}
     select sa.*, o.external_order_number, o.fulfillment_status,
       nullif(trim(o.customer->>'name'), '') as customer_name,
       items.items,
       count(*) over()::int as total_count
     from sales sa
     join orders o on o.id = sa.id
     cross join lateral (
       select coalesce(json_agg(json_build_object(
         'name', coalesce(nullif(trim(p.name), ''), nullif(trim(oi.description), '')),
         'sku', coalesce(nullif(trim(p.main_sku), ''), nullif(trim(oi.main_sku), ''), nullif(trim(oi.sku), '')),
         'quantity', oi.quantity,
         'unitCommission', case when p.id is null then null
           else coalesce(oi.commission_amount, p.commission_amount) end
       ) order by oi.id), '[]'::json) as items
       from order_items oi
       left join products p on p.id = oi.product_id
       where oi.order_id = sa.id
     ) items
     order by sa.sold_at desc, sa.id desc
     limit $4 offset $5`,
    [id, from, to, limit, offset],
  );
  const salesperson = normalizeSalespersonRow({ ...person.rows[0], orders_count: 0 });
  return {
    salesperson: {
      userId: salesperson.userId,
      name: salesperson.name,
      email: salesperson.email,
      active: salesperson.active,
      commissionPercent: salesperson.commissionPercent,
    },
    range: { from, to },
    currency: EARNINGS_CURRENCY,
    sales: result.rows.map((row) => ({
      orderId: Number(row.id),
      orderNumber: row.external_order_number || String(row.id),
      soldAt: row.sold_at ? new Date(row.sold_at).toISOString() : null,
      customerName: row.customer_name || null,
      total: money(row.total),
      commission: money(row.commission),
      commissionRule: COMMISSION_RULES.includes(row.commission_rule) ? row.commission_rule : 'missing',
      linesWithoutCommission: Math.max(0, (Number(row.lines_count) || 0) - (Number(row.priced_lines) || 0)),
      paymentStatus: row.payment_status || 'unknown',
      fulfillmentStatus: row.fulfillment_status || null,
      units: Number(row.units) || 0,
      items: normalizeSaleItems(row.items),
    })),
    totalCount: Number(result.rows[0]?.total_count || 0),
    limit,
    offset,
  };
}
