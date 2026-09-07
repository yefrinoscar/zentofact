import test from 'node:test';
import assert from 'node:assert/strict';
import { lineSaleMoney, listProductSalesReport, parseProductSalesFilters, takeRateFromSamples } from './product-sales-report.js';

function compact(sql) {
  return String(sql || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

test('el filtro de ventas de productos usa el periodo de Lima y ordena por ventas brutas', () => {
  const filters = parseProductSalesFilters({ from: '2026-08-01', to: '2026-08-31', search: 'AG301' });
  assert.equal(filters.from, '2026-08-01');
  assert.equal(filters.to, '2026-08-31');
  assert.equal(filters.sortBy, 'grossSales');
  assert.equal(filters.sortDir, 'desc');
  assert.equal(filters.search, 'AG301');
  assert.equal(filters.limit, 20);
});

test('el reporte rechaza un rango invertido o un sort inválido', () => {
  assert.throws(() => parseProductSalesFilters({ from: '2026-08-31', to: '2026-08-01' }), /fecha inicial/i);
  assert.throws(() => parseProductSalesFilters({ sortBy: 'visits' }), /sortBy inválido/);
  assert.throws(() => parseProductSalesFilters({ from: 'no-es-fecha' }), /Fecha inválida/);
});

test('las ventas de productos suman asociaciones y detallan cada seller', async () => {
  const statements = [];
  const db = {
    query: async (sql, params) => {
      statements.push({ sql, params });
      const text = compact(sql);
      if (text.includes('seller_rows as')) {
        return {
          rows: [{
            product_key: 'p:5',
            product_id: 5,
            sku: 'AG301',
            name: 'Agua 3L',
            image_url: null,
            brand: null,
            published: true,
            units_sold: 6,
            orders_count: 4,
            sellers_count: 2,
            revenue: 1139.4,
            falabella_take: 296.24,
            arrives: 842.16,
            paid_arrives: 140.52,
            pending_arrives: 701.64,
            visits: null,
            sellers: [
              {
                companyId: 8,
                companyName: 'LIMBO',
                channelCode: 'falabella',
                channelCodes: ['falabella'],
                sellerSku: 'LIMBO-AG301',
                published: true,
                unitsSold: 4,
                ordersCount: 3,
                grossSales: 759.6,
                falabellaTake: 197.5,
                arrives: 561.2,
                paidArrives: 0,
                pendingArrives: 561.2,
                visits: null,
              },
              {
                companyId: 9,
                companyName: 'MANTA RAYA',
                channelCode: 'falabella',
                sellerSku: 'MANTA-AG301',
                published: true,
                unitsSold: 2,
                ordersCount: 1,
                grossSales: 379.8,
                falabellaTake: 98.74,
                arrives: 280.96,
                paidArrives: 140.52,
                pendingArrives: 140.44,
                visits: null,
              },
            ],
          }],
        };
      }
      if (text.includes('as buyers_count')) {
        return {
          rows: [{
            products_count: 4,
            units_sold: 18,
            orders_count: 12,
            sellers_count: 3,
            buyers_count: 9,
            gross_sales: 2410.5,
            falabella_take: 626.73,
            arrives: 1783.77,
            paid_arrives: 421.56,
            pending_arrives: 1362.21,
            settlement_orders: 3,
          }],
        };
      }
      if (text.includes('buyer_key') && text.includes('limit 8')) {
        return {
          rows: [{
            buyer_key: '22334455',
            buyer_name: 'Alexander Preview',
            buyer_document: '22334455',
            buyer_email: null,
            orders_count: 2,
            units_bought: 5,
            revenue: 720,
            last_ordered_at: '2026-09-07T17:00:00.000Z',
          }],
        };
      }
      if (text.includes('product_key') && text.includes('limit 5')) {
        return {
          rows: [{
            product_key: 'p:5',
            product_id: 5,
            sku: 'AG301',
            name: 'Agua 3L',
            image_url: null,
            units_sold: 6,
            orders_count: 4,
            sellers_count: 2,
            revenue: 1139.4,
          }],
        };
      }
      if (text.includes('count(distinct product_key)')) {
        return { rows: [{ products_count: 1 }] };
      }
      return { rows: [] };
    },
  };

  const result = await listProductSalesReport({
    from: '2026-08-09',
    to: '2026-09-07',
    search: 'AG3',
    companyId: 8,
    sortBy: 'units',
  }, db);

  assert.equal(result.timezone, 'America/Lima');
  assert.equal(result.from, '2026-08-09');
  assert.equal(result.to, '2026-09-07');
  assert.equal(result.products[0].sku, 'AG301');
  assert.equal(result.products[0].unitsSold, 6);
  assert.equal(result.products[0].grossSales, 1139.4);
  assert.equal(result.products[0].falabellaTake, 296.24);
  assert.equal(result.products[0].arrives, 842.16);
  assert.equal(result.products[0].paidArrives, 140.52);
  assert.equal(result.products[0].pendingArrives, 701.64);
  assert.equal(result.products[0].sellers[0].pendingArrives, 561.2);
  assert.equal(result.products[0].sellers[1].paidArrives, 140.52);
  assert.equal(result.products[0].sellersCount, 2);
  assert.equal(result.products[0].sellers[0].falabellaTake, 197.5);
  assert.equal(result.products[0].sellers[0].companyName, 'LIMBO');
  assert.deepEqual(result.products[0].sellers[0].channelCodes, ['falabella']);
  assert.equal(result.products[0].sellers[1].unitsSold, 2);
  assert.equal(result.products[0].visits, null);
  assert.equal(result.totals.productsCount, 4);
  assert.equal(result.totals.buyersCount, 9);
  assert.equal(result.totals.falabellaTake, 626.73);
  assert.equal(result.totals.arrives, 1783.77);
  assert.equal(result.totals.paidArrives, 421.56);
  assert.equal(result.totals.pendingArrives, 1362.21);
  assert.equal(result.totals.settlementOrders, 3);
  assert.equal(result.totals.averageTicket, 2410.5 / 12);
  assert.equal(result.totalCount, 1);
  assert.equal(result.topProducts[0].sku, 'AG301');
  assert.equal(result.topBuyers[0].name, 'Alexander Preview');
  assert.equal(result.topBuyers[0].unitsBought, 5);

  const pageSql = statements.find((statement) => compact(statement.sql).includes('seller_rows as'))?.sql || '';
  assert.match(pageSql, /ordered_at at time zone 'America\/Lima'\)::date between \$1::date and \$2::date/i);
  assert.match(pageSql, /o\.company_id=\$3/);
  assert.match(pageSql, /left join sale_settlements ss/);
  assert.match(pageSql, /priced as/);
  assert.match(pageSql, /allocated_take/);
  assert.match(pageSql, /settlement_sale_id is null/);
  assert.match(pageSql, /matched_gross >= pr.gross \* 0.1/);
  assert.match(pageSql, /settlement_status = 'paid'/);
  assert.match(pageSql, /left join product_listings linked on linked\.id=oi\.listing_id/);
  assert.match(pageSql, /l\.channel_code='falabella'/);
  assert.match(pageSql, /coalesce\(linked\.channel_code, listing\.channel_code, ch\.code\) = 'falabella'/);
  assert.match(pageSql, /coalesce\(oi\.product_id, linked\.product_id, listing\.product_id\) is not null/);
  assert.match(pageSql, /left join order_channels ch/);
  assert.match(pageSql, /array_agg\(distinct channel_code\)/);
  assert.match(pageSql, /coalesce\(oi\.product_id, linked\.product_id, listing\.product_id\)/);
  assert.match(pageSql, /order by sum\(units_sold\) desc nulls last/);
  assert.match(pageSql, /customer->>'documentNumber'/);
  assert.doesNotMatch(pageSql, /promised_shipping_at/);
  assert.equal(statements[0].params[0], '2026-08-09');
  assert.equal(statements[0].params[1], '2026-09-07');
  assert.equal(statements[0].params.includes(8), true);
});

test('una venta sin cruce usa la tasa de Pagos y suma bruto = Falabella + te llega', () => {
  const rate = takeRateFromSamples({
    productGross: 11479.86,
    productMatchedGross: 1679.99,
    productMatchedTake: 341.4,
  });
  assert.ok(rate > 0.2 && rate < 0.21);
  const crossed = lineSaleMoney({
    lineTotal: 1679.99,
    allocatedTake: 341.4,
    allocatedNeto: 1338.59,
    paid: true,
    rate,
  });
  const open = lineSaleMoney({
    lineTotal: 9799.87,
    allocatedTake: null,
    allocatedNeto: null,
    paid: false,
    rate,
  });
  const take = crossed.falabellaTake + open.falabellaTake;
  const arrives = crossed.arrives + open.arrives;
  assert.equal((take + arrives).toFixed(2), '11479.86');
  assert.ok(arrives > 8000);
  assert.equal(open.paidArrives, 0);
  assert.equal(open.pendingArrives, open.arrives);
});

test('si el cruce del producto es poco, usa la tasa del seller', () => {
  const rate = takeRateFromSamples({
    productGross: 11105.12,
    productMatchedGross: 606,
    productMatchedTake: 414.16,
    companyMatchedGross: 20000,
    companyMatchedTake: 4000,
  });
  assert.equal(rate, 0.2);
});

