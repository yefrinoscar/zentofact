import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buyerCompaniesLabel,
  buyerIdentity,
  buyerPhoneLabel,
  hasBuyerPhone,
  buyerProductsLabel,
  channelLabel,
  arrivesMoneyHint,
  falabellaMoneyHint,
  formatBuyerPhone,
  formatSalesMoneyOrDash,
  isTrackedBuyer,
  paidMoneyHint,
  sortSalesBuyers,
  paidShare,
  pagosHint,
  pendingMoneyHint,
  sellerChannelLabel,
  splitSalesBuyers,
  productSalesKpis,
  productRestockAction,
  productRestockExplanation,
  publishedLabel,
  restockFormula,
  restockWhyLabel,
  salesCurveNote,
  sellerSalesLabel,
  skipDetail,
  skipReasonLabel,
  skipWhyLabel,
  stockIsLow,
  weekdayUnits,
  TRACKED_BUYER_MIN_UNITS,
} from './product-sales-presentation.ts';

test('los kpis muestran ventas y unidades vendidas sin duplicar importes', () => {
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
  assert.deepEqual(kpis.map((item) => item.label), ['Ventas', 'Unidades vendidas']);
  assert.equal(String(kpis[0].display).replace(/\u00a0/g, ' '), 'S/ 2,410.50');
  assert.equal(kpis[1].display, '18');
  assert.equal(kpis[0].why, 'Monto vendido en el periodo.');
  assert.equal(kpis[1].why, '12 pedidos en el periodo.');
  assert.equal(paidShare(421.56, 1362.21).toFixed(4), (421.56 / (421.56 + 1362.21)).toFixed(4));
});

test('los textos de pagos explican los importes conciliados', () => {
  assert.equal(paidMoneyHint({ paidArrives: 140.52 }), 'Ya está en tu cuenta.');
  assert.equal(pendingMoneyHint({ pendingArrives: 421.56 }), 'Aún no depositan.');
  assert.equal(formatSalesMoneyOrDash(null), '—');
  assert.equal(falabellaMoneyHint({
    falabellaTake: null,
    sellers: [{ channelCode: 'manual', channelCodes: ['manual'] }],
  }), 'Sin cobro de Falabella.');
  assert.equal(arrivesMoneyHint({ arrives: 140.52 }), 'Después de cobros del canal.');
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
  assert.equal(hasBuyerPhone(tracked), true);
  assert.equal(hasBuyerPhone({ phone: '' }), false);
  assert.equal(hasBuyerPhone({ phone: '123' }), false);
  assert.equal(buyerCompaniesLabel(tracked), 'Limbo · Manta raya');
  assert.equal(buyerProductsLabel(tracked), 'BB220 · 7 u');
  assert.deepEqual(sortSalesBuyers([other, tracked], 'units', 'desc').map((buyer) => buyer.name), ['Max Preview', 'Ana Preview']);
  assert.deepEqual(sortSalesBuyers([other, tracked], 'name', 'asc').map((buyer) => buyer.name), ['Ana Preview', 'Max Preview']);
});

test('explica qué traer y qué no tocar', () => {
  assert.equal(stockIsLow(3), true);
  assert.equal(stockIsLow(20), false);
  assert.equal(productRestockAction({ restockQty: 12, unitsPerDay: 1.5 }), 'bringBack');
  assert.equal(productRestockAction({ restockQty: 12, unitsPerDay: 0.3 }), 'doNotBring');
  assert.equal(productRestockAction({ restockQty: 0, unitsPerDay: 1.5 }), 'doNotBring');
  const normalize = (value) => String(value).replace(/\u00a0/g, ' ').replace(',', '.');
  assert.equal(
    normalize(restockWhyLabel({ unitsPerDay: 2.4, available: 8, coverDays: 3.3, pace: 'stable' })),
    '2.4 u/día · 8 u en almacén · se acaba en 3 días',
  );
  assert.equal(
    normalize(restockWhyLabel({ unitsPerDay: 1.8, available: 6, coverDays: 3.3, pace: 'up' })),
    '1.8 u/día · 6 u en almacén · curva al alza',
  );
  assert.match(
    skipWhyLabel({ sku: 'AG293', name: 'Guantes', unitsPerDay: 0.3, coverDays: 92, keepsPerDay: 6 }),
    /92 días de stock/,
  );
  assert.equal(normalize(restockFormula({ unitsPerDay: 2.4, horizonDays: 30, available: 8, restockQty: 64 })), '2.4 × 30 − 8 = 64');
  const note = salesCurveNote({
    productKey: 'p:294',
    productId: 294,
    sku: 'AG294',
    name: 'Coche',
    published: true,
    unitsSold: 72,
    ordersCount: 61,
    sellersCount: 2,
    grossSales: 10000,
    falabellaTake: 2000,
    arrives: 8000,
    paidArrives: 4000,
    pendingArrives: 4000,
    visits: null,
    unitsPerDay: 2.4,
    keepsPerUnit: 20,
    hasWholesaleCost: true,
    pace: 'up',
    weekendShare: 0.6,
    sellers: [],
  });
  assert.match(note.title, /acelerando/i);
  assert.match(note.detail, /jueves a domingo/);
  assert.match(note.detail.replace(/\u00a0/g, ' '), /S\/ 20/);
  assert.equal(skipReasonLabel('overstock'), 'Stock de sobra');
  assert.equal(skipReasonLabel('lowKeep'), 'Vende, deja poco');
  assert.match(skipDetail({ unitsPerDay: 0.3, coverDays: 92, skipReason: 'overstock' }), /92/);
  const week = weekdayUnits([
    { date: '2026-09-10', units: 2 },
    { date: '2026-09-11', units: 5 },
    { date: '2026-09-12', units: 1 },
  ]);
  assert.deepEqual(week.map((day) => day.label), ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']);
  assert.equal(week.find((day) => day.label === 'Jue')?.units, 2);
  assert.equal(week.find((day) => day.label === 'Vie')?.units, 5);
  assert.equal(week.find((day) => day.label === 'Sáb')?.units, 1);
});

test('explica la recomendación de reposición con stock, cobertura y venta', () => {
  const normalize = (value) => String(value).replace(/\u00a0/g, ' ').replace(/(\d),(\d)/g, '$1.$2');

  assert.equal(
    normalize(productRestockExplanation({
      available: 66,
      coverDays: 50,
      horizonDays: 30,
      restockQty: 0,
      unitsPerDay: 1.3,
    })),
    'No traer. Vende 1.3 u/día, pero tienes 66 unidades: cubren 50 días.',
  );
  assert.equal(
    normalize(productRestockExplanation({
      available: 10,
      coverDays: 9,
      horizonDays: 30,
      restockQty: 25,
      unitsPerDay: 1.2,
    })),
    'Volver a traer. Tienes 10 unidades: cubren 9 días. Trae 25 para cubrir 30 días.',
  );
  assert.equal(
    normalize(productRestockExplanation({
      available: 0,
      coverDays: 0,
      horizonDays: 30,
      restockQty: 9,
      unitsPerDay: 0.3,
    })),
    'No traer. Se vende 0.3 u/día. Espera más movimiento antes de reponer.',
  );
});
