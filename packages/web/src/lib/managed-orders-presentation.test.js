import assert from 'node:assert/strict';
import test from 'node:test';
import { createTable, functionalUpdate, getCoreRowModel } from '@tanstack/react-table';
import {
  MANAGED_ORDER_LIST_LIMIT,
  MANAGED_ORDER_TABLE_COLUMNS,
  buildManagedOrderListFilters,
  buildManagedOrderSummaryFilters,
  managedOrderChannelTabs,
  managedOrderListRows,
  managedOrderStageCounts,
  deliveryLabel,
  deliveryShowsAsTag,
  isSalespersonOrder,
  managedOrderSearchIgnoresDate,
  managedOrdersDateAfterDayChange,
  managedOrdersEmptyHint,
  managedOrdersEmptyTitle,
  managedOrdersSearchHelper,
  managedOrdersTableLabel,
  sellerCellLabel,
  sellerCellShowsPerson,
} from './managed-orders-presentation.ts';

test('cambiar a un origen sin datos no genera un bucle de renders durante la carga', async () => {
  let updates = 0;
  let state;
  let response = [{ id: 1 }];
  const table = createTable({
    data: managedOrderListRows(response),
    columns: [],
    getCoreRowModel: getCoreRowModel(),
    state: {},
    onStateChange(updater) {
      state = functionalUpdate(updater, state);
      updates += 1;
      if (updates < 30) queueMicrotask(render);
    },
  });
  state = table.initialState;
  function render() {
    table.setOptions((previous) => ({
      ...previous,
      data: managedOrderListRows(response),
      state,
    }));
    table.getRowModel();
  }
  render();
  await new Promise((resolve) => setTimeout(resolve, 0));
  response = undefined;
  render();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(updates <= 1, `La tabla reinició su estado ${updates} veces durante la carga`);
  assert.equal(table.getRowModel().rows.length, 0);

  response = [{ id: 2 }];
  render();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(table.getRowModel().rows[0].original.id, 2);
});

test('la bandeja avanza a hoy si permaneció abierta durante la medianoche', () => {
  assert.equal(managedOrdersDateAfterDayChange({
    selectedDate: '2026-09-06',
    previousToday: '2026-09-06',
    currentToday: '2026-09-07',
  }), '2026-09-07');

  assert.equal(managedOrdersDateAfterDayChange({
    selectedDate: '2026-09-05',
    previousToday: '2026-09-06',
    currentToday: '2026-09-07',
  }), '2026-09-05');
});

test('la bandeja de pedidos entra sin scroll: seller bajo el pedido, entrega y método en el detalle', () => {
  assert.equal(MANAGED_ORDER_TABLE_COLUMNS.includes('phone'), false);
  assert.ok(MANAGED_ORDER_TABLE_COLUMNS.includes('product'));
  assert.ok(MANAGED_ORDER_TABLE_COLUMNS.includes('customer'));
  assert.ok(MANAGED_ORDER_TABLE_COLUMNS.includes('status'));
  assert.ok(MANAGED_ORDER_TABLE_COLUMNS.includes('total'));
  for (const moved of ['seller', 'origin', 'delivery', 'address', 'time', 'method']) {
    assert.equal(MANAGED_ORDER_TABLE_COLUMNS.includes(moved), false, moved);
  }
});

test('las pestañas de canal suman pedidos y venta, y muestran canales sin pedidos', () => {
  const groups = [
    { channelCode: 'falabella', fulfillmentStatus: 'pending', ordersCount: 3, salesTotal: 300 },
    { channelCode: 'falabella', fulfillmentStatus: 'cancelled', ordersCount: 1, salesTotal: 0 },
    { channelCode: 'manual', fulfillmentStatus: 'delivered', ordersCount: 2, salesTotal: 100 },
    { channelCode: 'shopify', channelName: 'Shopify', fulfillmentStatus: 'pending', ordersCount: 1, salesTotal: 0 },
  ];
  const tabs = managedOrderChannelTabs(groups, [
    { code: 'falabella', name: 'Falabella' },
    { code: 'ripley', name: 'Ripley' },
    { code: 'manual', name: 'Tienda' },
  ]);
  assert.deepEqual(tabs.map((tab) => [tab.code, tab.ordersCount, tab.salesTotal, tab.share]), [
    ['all', 7, 400, 100],
    ['falabella', 4, 300, 75],
    ['ripley', 0, 0, 0],
    ['manual', 2, 100, 25],
    ['shopify', 1, 0, 0],
  ]);
  assert.equal(tabs.at(-1).label, 'Shopify');
});

test('las etapas cuentan pedidos del canal elegido', () => {
  const groups = [
    { channelCode: 'falabella', fulfillmentStatus: 'pending', ordersCount: 3, salesTotal: 0 },
    { channelCode: 'falabella', fulfillmentStatus: 'preparing', ordersCount: 2, salesTotal: 0 },
    { channelCode: 'falabella', fulfillmentStatus: 'returned', ordersCount: 1, salesTotal: 0 },
    { channelCode: 'ripley', fulfillmentStatus: 'ready_to_ship', ordersCount: 4, salesTotal: 0 },
  ];
  assert.deepEqual(managedOrderStageCounts(groups, 'falabella'), {
    all: 6, to_prepare: 5, ready: 0, shipped: 0, delivered: 0, issues: 1,
  });
  assert.equal(managedOrderStageCounts(groups, 'all').ready, 4);
});

test('deliveryLabel resume tienda, repartidor, envío y marketplace', () => {
  assert.equal(deliveryLabel({ shipping: { type: 'recojo' } }), 'Tienda');
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
    channelCode: 'all',
    stage: 'all',
    date: '2026-09-04',
    search: '',
  });
  assert.equal(dayFilters.fulfillmentStatuses, undefined);
  assert.equal(dayFilters.from, '2026-09-04');
  assert.equal(dayFilters.to, '2026-09-04');
  assert.equal(dayFilters.search, undefined);
  assert.equal(dayFilters.includeItems, true);
  assert.equal(dayFilters.limit, MANAGED_ORDER_LIST_LIMIT);

  const searchFilters = buildManagedOrderListFilters({
    channelCode: 'falabella',
    stage: 'to_prepare',
    date: '2026-09-04',
    search: '  3250666811  ',
  });
  assert.equal('from' in searchFilters, false);
  assert.equal('to' in searchFilters, false);
  assert.equal(searchFilters.search, '3250666811');
  assert.equal('companyId' in searchFilters, false);
  assert.equal(searchFilters.channelCode, 'falabella');
  assert.equal(searchFilters.fulfillmentStatuses, 'unmapped,pending,preparing');
  assert.deepEqual(buildManagedOrderSummaryFilters({ date: '2026-09-04', search: ' 3250666811 ' }), { search: '3250666811' });
  assert.deepEqual(buildManagedOrderSummaryFilters({ date: '2026-09-04', search: '' }), { from: '2026-09-04', to: '2026-09-04', search: undefined });
  assert.equal(managedOrderSearchIgnoresDate('3250666811'), true);
  assert.equal(managedOrderSearchIgnoresDate('   '), false);
  assert.equal(managedOrdersTableLabel('hoy', '3250666811'), 'Pedidos con 3250666811');
  assert.equal(managedOrdersTableLabel('hoy', ''), 'Pedidos de hoy');
  assert.equal(managedOrdersEmptyTitle('3250666811'), 'No hay pedidos con esa búsqueda');
  assert.equal(managedOrdersEmptyHint('3250666811'), 'La búsqueda ignora la fecha. Prueba otro dato.');
  assert.equal(managedOrdersSearchHelper('3250666811'), 'Busca en todos los días.');
  assert.equal(managedOrdersSearchHelper(''), '');
});

test('la columna Seller muestra el nombre del vendedor en ventas manuales', () => {
  const companyById = new Map([[7, 'Limbo']]);
  assert.equal(isSalespersonOrder({ channelCode: 'manual' }), true);
  assert.equal(isSalespersonOrder({ createdByRole: 'vendedor' }), true);
  assert.equal(isSalespersonOrder({ channelCode: 'falabella' }), false);
  assert.equal(sellerCellLabel({
    companyId: 7,
    channelCode: 'manual',
    createdByName: 'Vendedor Preview',
    createdByRole: 'vendedor',
  }, companyById), 'Vendedor Preview');
  assert.equal(sellerCellLabel({
    companyId: null,
    channelCode: 'manual',
    createdByName: '  Juan Pérez  ',
  }, companyById), 'Juan Pérez');
  assert.equal(sellerCellLabel({
    companyId: 7,
    channelCode: 'falabella',
    createdByName: 'Vendedor Preview',
  }, companyById), 'Limbo');
  assert.equal(sellerCellLabel({
    companyId: null,
    channelCode: 'manual',
  }, companyById), '');
  assert.equal(sellerCellLabel({
    companyId: 9,
    channelCode: 'ripley',
  }, companyById), 'Empresa 9');
  assert.equal(sellerCellShowsPerson({
    channelCode: 'manual',
    createdByName: 'Cesar Alfaro',
  }), true);
  assert.equal(sellerCellShowsPerson({
    channelCode: 'falabella',
    createdByName: 'Cesar Alfaro',
  }), false);
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
