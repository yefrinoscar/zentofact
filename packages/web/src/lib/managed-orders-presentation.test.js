import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MANAGED_ORDER_LIST_LIMIT,
  MANAGED_ORDER_TABLE_COLUMNS,
  buildManagedOrderListFilters,
  deliveryLabel,
  deliveryShowsAsTag,
  managedOrderSearchIgnoresDate,
  managedOrdersEmptyHint,
  managedOrdersEmptyTitle,
  managedOrdersSearchHelper,
  managedOrdersTableLabel,
} from './managed-orders-presentation.ts';

test('la bandeja de pedidos no muestra columna de teléfono', () => {
  assert.equal(MANAGED_ORDER_TABLE_COLUMNS.includes('phone'), false);
  assert.ok(MANAGED_ORDER_TABLE_COLUMNS.includes('delivery'));
  assert.ok(MANAGED_ORDER_TABLE_COLUMNS.includes('customer'));
});

test('deliveryLabel resume recojo, repartidor, envío y marketplace', () => {
  assert.equal(deliveryLabel({ shipping: { type: 'recojo' } }), 'Recojo');
  assert.equal(deliveryLabel({ shipping: { type: 'envio', carrier: 'marvisuar' } }), 'Marvisuar');
  assert.equal(deliveryLabel({ shipping: { type: 'envio' } }), 'Envío');
  assert.equal(deliveryLabel({ channelCode: 'falabella', shipping: {} }), 'Marketplace');
  assert.equal(deliveryLabel({ channelCode: 'manual', shipping: {} }), '—');
});

test('regresión: entrega con valor operativo se presenta como tag', () => {
  assert.equal(deliveryShowsAsTag(deliveryLabel({ shipping: { type: 'recojo' } })), true);
  assert.equal(deliveryShowsAsTag(deliveryLabel({ shipping: { carrier: 'shaloom' } })), true);
  assert.equal(deliveryShowsAsTag(deliveryLabel({ channelCode: 'manual', shipping: {} })), false);
});

test('la búsqueda de pedidos omite la fecha comercial del día', () => {
  const dayFilters = buildManagedOrderListFilters({
    companyId: 'all',
    channelCode: 'all',
    fulfillmentStatus: 'all',
    date: '2026-09-04',
    search: '',
  });
  assert.equal(dayFilters.from, '2026-09-04');
  assert.equal(dayFilters.to, '2026-09-04');
  assert.equal(dayFilters.search, undefined);
  assert.equal(dayFilters.limit, MANAGED_ORDER_LIST_LIMIT);

  const searchFilters = buildManagedOrderListFilters({
    companyId: '7',
    channelCode: 'falabella',
    fulfillmentStatus: 'pending',
    date: '2026-09-04',
    search: '  3250666811  ',
  });
  assert.equal('from' in searchFilters, false);
  assert.equal('to' in searchFilters, false);
  assert.equal(searchFilters.search, '3250666811');
  assert.equal(searchFilters.companyId, 7);
  assert.equal(searchFilters.channelCode, 'falabella');
  assert.equal(searchFilters.fulfillmentStatus, 'pending');
  assert.equal(managedOrderSearchIgnoresDate('3250666811'), true);
  assert.equal(managedOrderSearchIgnoresDate('   '), false);
  assert.equal(managedOrdersTableLabel('hoy', '3250666811'), 'Pedidos con 3250666811');
  assert.equal(managedOrdersTableLabel('hoy', ''), 'Pedidos de hoy');
  assert.equal(managedOrdersEmptyTitle('3250666811'), 'No hay pedidos con esa búsqueda');
  assert.equal(managedOrdersEmptyHint('3250666811'), 'La búsqueda ignora la fecha. Prueba otro dato.');
  assert.equal(managedOrdersSearchHelper('3250666811'), 'Busca en todos los días.');
  assert.equal(managedOrdersSearchHelper(''), '');
});

test('regresión: etiquetas de reparto alineadas con shipping-carrier', async () => {
  const { SHIPPING_CARRIERS } = await import('./shipping-carrier.ts');
  for (const carrier of SHIPPING_CARRIERS) {
    assert.equal(
      deliveryLabel({ shipping: { type: 'envio', carrier: carrier.value } }),
      carrier.label,
    );
  }
});
