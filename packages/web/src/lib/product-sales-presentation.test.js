import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buyerIdentity,
  channelLabel,
  formatVisits,
  productSalesKpis,
  publishedLabel,
  sellerSalesLabel,
  visitsHint,
} from './product-sales-presentation.ts';

test('los kpis de ventas cubren el periodo y el ritmo', () => {
  const kpis = productSalesKpis({
    productsCount: 4,
    unitsSold: 18,
    ordersCount: 12,
    sellersCount: 3,
    buyersCount: 9,
    grossSales: 2410.5,
    averageTicket: 200.875,
    visits: null,
  });
  assert.deepEqual(kpis.map((item) => item.label), [
    'Ventas brutas', 'Unidades', 'Pedidos', 'Ticket', 'Productos', 'Compradores',
  ]);
  assert.equal(String(kpis[0].display).replace(/\u00a0/g, ' '), 'S/ 2,410.50');
  assert.equal(kpis[1].display, '18 u');
  assert.equal(kpis[1].why, 'Piezas que salieron.');
  assert.equal(kpis[4].why, 'SKUs que vendieron.');
});

test('sin visitas el dato queda vacío y el seller usa el nombre corto', () => {
  assert.equal(formatVisits(null), '—');
  assert.equal(visitsHint(), 'El canal no envía visitas.');
  assert.equal(publishedLabel(true), 'Sí');
  assert.equal(publishedLabel(false), 'No');
  assert.equal(channelLabel('falabella'), 'Falabella');
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
