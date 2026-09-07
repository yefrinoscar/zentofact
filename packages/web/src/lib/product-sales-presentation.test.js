import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buyerCompaniesLabel,
  buyerIdentity,
  buyerPhoneLabel,
  buyerProductsLabel,
  channelLabel,
  arrivesMoneyHint,
  falabellaMoneyHint,
  formatBuyerPhone,
  formatSalesMoneyOrDash,
  hasBuyerColumnFilters,
  isTrackedBuyer,
  matchesBuyerColumnFilters,
  paidMoneyHint,
  paidShare,
  pagosHint,
  pendingMoneyHint,
  sellerChannelLabel,
  splitSalesBuyers,
  productSalesKpis,
  publishedLabel,
  sellerSalesLabel,
  TRACKED_BUYER_MIN_UNITS,
} from './product-sales-presentation.ts';

test('los kpis muestran el total de te llega y el desglose pagado/pendiente', () => {
  const kpis = productSalesKpis({
    productsCount: 4,
    unitsSold: 18,
    ordersCount: 12,
    sellersCount: 3,
    buyersCount: 9,
    grossSales: 2410.5,
    falabellaTake: 626.73,
    arrives: 1783.77,
    paidArrives: 421.56,
    pendingArrives: 1362.21,
    settlementOrders: 3,
    averageTicket: 200.875,
    visits: null,
  });
  assert.deepEqual(kpis.map((item) => item.label), ['Ventas brutas', 'Te llega']);
  assert.equal(String(kpis[0].display).replace(/\u00a0/g, ' '), 'S/ 2,410.50');
  assert.equal(String(kpis[1].display).replace(/\u00a0/g, ' '), 'S/ 1,783.77');
  assert.equal(kpis[0].why, '18 u · 12 pedidos.');
  assert.equal(kpis[1].why, 'Lo que entra a tu cuenta.');
  assert.equal(kpis[1].paid, 421.56);
  assert.equal(kpis[1].pending, 1362.21);
  assert.equal(kpis[1].tone, 'receive');
  assert.equal(paidShare(421.56, 1362.21).toFixed(4), (421.56 / (421.56 + 1362.21)).toFixed(4));
});

test('sin cruce de Pagos te llega queda vacío', () => {
  const kpis = productSalesKpis({
    productsCount: 1,
    unitsSold: 2,
    ordersCount: 1,
    sellersCount: 1,
    buyersCount: 1,
    grossSales: 100,
    falabellaTake: null,
    arrives: null,
    paidArrives: null,
    pendingArrives: null,
    settlementOrders: 0,
    averageTicket: 100,
    visits: null,
  });
  assert.equal(kpis[1].display, '—');
  assert.equal(kpis[1].why, pagosHint());
  assert.equal(kpis[1].paid, null);
  assert.equal(paidMoneyHint({ paidArrives: 140.52 }), 'Ya está en tu cuenta.');
  assert.equal(pendingMoneyHint({ pendingArrives: 421.56 }), 'Aún no depositan.');
  assert.equal(formatSalesMoneyOrDash(null), '—');
  assert.equal(falabellaMoneyHint({
    falabellaTake: null,
    sellers: [{ channelCode: 'manual', channelCodes: ['manual'] }],
  }), 'Sin cobro de Falabella.');
  assert.equal(arrivesMoneyHint({ arrives: 140.52 }), 'Lo que entra a tu cuenta.');
});

test('el seller usa el nombre corto', () => {
  assert.equal(publishedLabel(true), 'Sí');
  assert.equal(publishedLabel(false), 'No');
  assert.equal(channelLabel('falabella'), 'Falabella');
  assert.equal(sellerChannelLabel({ channelCodes: ['falabella', 'manual'] }), 'Falabella · Manual');
  assert.equal(sellerSalesLabel({ companyName: 'INVERSIONES YAKURUNA S.A.C.' }), 'Yakuruna');
  assert.equal(buyerIdentity({
    buyerKey: '22334455',
    name: 'Alexander Preview',
    documentNumber: '22334455',
    ordersCount: 1,
    unitsBought: 4,
    grossSales: 100,
  }), '22334455');
});

test('agrupa compradores de más de 5 unidades y arma el detalle', () => {
  const tracked = {
    buyerKey: '74561743',
    name: 'Max Preview',
    documentNumber: '74561743',
    phone: '987654321',
    tracked: true,
    companies: [
      { companyId: 8, companyName: 'LIMBO', unitsBought: 4, ordersCount: 1, grossSales: 182 },
      { companyId: 9, companyName: 'INVERSIONES MANTA RAYA S.A.C.', unitsBought: 3, ordersCount: 1, grossSales: 136.5 },
    ],
    products: [{ productKey: 'p:9', sku: 'BB220', name: 'Set platos', unitsBought: 7, grossSales: 318.5 }],
    ordersCount: 2,
    unitsBought: 7,
    grossSales: 318.5,
  };
  const other = {
    buyerKey: '12345678',
    name: 'Ana Preview',
    documentNumber: '12345678',
    phone: '999111001',
    companies: [{ companyId: 8, companyName: 'LIMBO', unitsBought: 1, ordersCount: 1, grossSales: 189.9 }],
    products: [],
    ordersCount: 1,
    unitsBought: 1,
    grossSales: 189.9,
  };
  assert.equal(TRACKED_BUYER_MIN_UNITS, 5);
  assert.equal(isTrackedBuyer(tracked), true);
  assert.equal(isTrackedBuyer({ unitsBought: 5 }), false);
  assert.equal(isTrackedBuyer({ unitsBought: 6 }), true);
  assert.deepEqual(splitSalesBuyers([other, tracked]).tracked.map((buyer) => buyer.name), ['Max Preview']);
  assert.equal(formatBuyerPhone('987654321'), '987 654 321');
  assert.equal(buyerPhoneLabel(tracked), '987 654 321');
  assert.equal(buyerCompaniesLabel(tracked), 'Limbo · Manta raya');
  assert.equal(buyerProductsLabel(tracked), 'BB220 · 7 u');
  assert.equal(hasBuyerColumnFilters({
    name: '',
    document: '',
    phone: '',
    company: 'manta',
    minUnits: '',
    minGrossSales: '',
  }), true);
  assert.equal(matchesBuyerColumnFilters(tracked, {
    name: 'max',
    document: '7456',
    phone: '987',
    company: 'manta',
    minUnits: '6',
    minGrossSales: '300',
  }), true);
  assert.equal(matchesBuyerColumnFilters(other, {
    name: '',
    document: '',
    phone: '',
    company: 'manta',
    minUnits: '',
    minGrossSales: '',
  }), false);
});
