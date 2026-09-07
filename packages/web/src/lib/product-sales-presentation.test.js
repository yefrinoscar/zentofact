import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buyerIdentity,
  channelLabel,
  arrivesMoneyHint,
  falabellaMoneyHint,
  formatSalesMoneyOrDash,
  formatVisits,
  pagosHint,
  sellerChannelLabel,
  productSalesKpis,
  publishedLabel,
  sellerSalesLabel,
  visitsHint,
} from './product-sales-presentation.ts';

test('los kpis de ventas ponen Falabella y te llega al lado de la venta bruta', () => {
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
  assert.deepEqual(kpis.map((item) => item.label), [
    'Ventas brutas', 'Falabella', 'Te llega', 'Unidades', 'Pedidos', 'Ticket',
  ]);
  assert.equal(String(kpis[0].display).replace(/\u00a0/g, ' '), 'S/ 2,410.50');
  assert.equal(String(kpis[1].display).replace(/\u00a0/g, ' '), 'S/ 626.73');
  assert.equal(kpis[1].why, 'Comisión y logística.');
  assert.equal(kpis[2].why, 'Pagado y pendiente.');
  assert.equal(kpis[3].display, '18 u');
});

test('sin cruce de Pagos Falabella y te llega quedan vacíos', () => {
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
  assert.equal(kpis[2].display, '—');
  assert.equal(kpis[1].why, pagosHint());
  assert.equal(formatSalesMoneyOrDash(null), '—');
  assert.equal(falabellaMoneyHint({
    falabellaTake: null,
    sellers: [{ channelCode: 'manual', channelCodes: ['manual'] }],
  }), 'Sin cobro de Falabella.');
  assert.equal(arrivesMoneyHint({ arrives: 140.52 }), 'Lo que te depositan.');
});

test('sin visitas el dato queda vacío y el seller usa el nombre corto', () => {
  assert.equal(formatVisits(null), '—');
  assert.equal(visitsHint(), 'El canal no envía visitas.');
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
