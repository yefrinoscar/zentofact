import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buyerIdentity,
  channelLabel,
  arrivesMoneyHint,
  falabellaMoneyHint,
  formatSalesMoneyOrDash,
  paidMoneyHint,
  paidShare,
  pagosHint,
  pendingMoneyHint,
  sellerChannelLabel,
  productSalesKpis,
  publishedLabel,
  sellerSalesLabel,
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
