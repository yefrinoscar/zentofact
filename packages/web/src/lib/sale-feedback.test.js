import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOptimisticSale,
  humanizeSaleError,
  registeredFromMisVentasState,
  saleSavedSnackbarMessage,
  saleSaveFailedSnackbarMessage,
  saleValidationField,
} from './sale-feedback.ts';

test('saleSavedSnackbarMessage es una sola línea operativa', () => {
  const message = saleSavedSnackbarMessage({
    number: '2608251234',
    customer: 'Ana Pérez',
    total: 299.9,
  });
  assert.match(message, /^Venta guardada · Ana Pérez · /);
  assert.doesNotMatch(message, /\n/);
});

test('humanizeSaleError oculta SQL y deja pasar validaciones cortas', () => {
  assert.match(
    humanizeSaleError('Failed query: column "items_status" of relation "orders" does not exist'),
    /No se pudo guardar/,
  );
  assert.equal(humanizeSaleError('Escribe el nombre del cliente.'), 'Escribe el nombre del cliente.');
});

test('saleSaveFailedSnackbarMessage no expone SQL', () => {
  assert.doesNotMatch(
    saleSaveFailedSnackbarMessage('Failed query: boom'),
    /Failed query/i,
  );
});

test('saleValidationField ubica el error en la sección correcta', () => {
  assert.equal(saleValidationField('Escribe el nombre del cliente.'), 'customer');
  assert.equal(saleValidationField('Escribe un teléfono de 9 dígitos.'), 'customer');
  assert.equal(saleValidationField('Escribe el DNI de 8 dígitos.'), 'document');
  assert.equal(saleValidationField('Escribe el RUC de 11 dígitos.'), 'document');
  assert.equal(saleValidationField('Escribe la dirección fiscal.'), 'document');
  assert.equal(saleValidationField('Agrega al menos un producto.'), 'products');
  assert.equal(saleValidationField('Ese producto no tiene stock.'), 'products');
  assert.equal(saleValidationField('No hay stock para esa cantidad.'), 'products');
  assert.equal(saleValidationField('Elige el reparto: Marvisuar, Shaloom, Dinsides o Express.'), 'delivery');
  assert.equal(saleValidationField('Express no llega ahí. Elige Marvisuar, Shaloom o Dinsides.'), 'delivery');
  assert.equal(saleValidationField('Indica el precio de envío.'), 'delivery');
});

test('applyOptimisticSale agrega la venta y sube hoy/mes', () => {
  const next = applyOptimisticSale(
    {
      today: { orders: 1, total: 100, commission: 10 },
      month: { orders: 1, total: 100, commission: 10 },
      orders: [{ externalOrderNumber: 'OLD', total: 100 }],
      commissionPercent: 10,
    },
    {
      externalOrderNumber: 'NEW',
      customer: { name: 'Luis' },
      total: 50,
      metadata: { paymentMethod: 'despues' },
      orderedAt: '2026-08-25T12:00:00Z',
    },
  );
  assert.equal(next.orders?.[0]?.externalOrderNumber, 'NEW');
  assert.equal(next.today?.orders, 2);
  assert.equal(next.ordersTotal, 2);
});

test('applyOptimisticSale sube la barra del día, el conteo y respeta el tamaño de página', () => {
  const next = applyOptimisticSale(
    {
      today: { orders: 1, total: 100, commission: 10 },
      month: { orders: 1, total: 100, commission: 10 },
      daily: [
        { date: '2026-08-24', orders: 0, total: 0, commission: 0 },
        { date: '2026-08-25', orders: 1, total: 100, commission: 10 },
      ],
      orders: [{ externalOrderNumber: 'A', total: 100 }, { externalOrderNumber: 'B', total: 100 }],
      ordersTotal: 12,
      limit: 2,
      commissionPercent: 10,
    },
    { externalOrderNumber: 'NEW', total: 50, orderedAt: '2026-08-25T20:00:00Z' },
  );
  assert.deepEqual(next.daily?.[1], { date: '2026-08-25', orders: 2, total: 150, commission: 15 });
  assert.deepEqual(next.daily?.[0], { date: '2026-08-24', orders: 0, total: 0, commission: 0 });
  assert.equal(next.ordersTotal, 13);
  assert.deepEqual(next.orders?.map((row) => row.externalOrderNumber), ['NEW', 'A']);
});

test('applyOptimisticSale sin prepend solo actualiza indicadores', () => {
  const next = applyOptimisticSale(
    {
      today: { orders: 0, total: 0, commission: 0 },
      month: { orders: 3, total: 300, commission: 30 },
      orders: [{ externalOrderNumber: 'A', total: 100 }],
      ordersTotal: 3,
      commissionPercent: 10,
    },
    { externalOrderNumber: 'NEW', total: 50 },
    10,
    { prepend: false },
  );
  assert.deepEqual(next.orders?.map((row) => row.externalOrderNumber), ['A']);
  assert.equal(next.month?.orders, 4);
  assert.equal(next.ordersTotal, 4);
});

test('registeredFromMisVentasState acepta string legacy y objeto', () => {
  assert.deepEqual(registeredFromMisVentasState({ registered: 'ABC' }), {
    number: 'ABC',
    customer: '',
    total: 0,
  });
  assert.deepEqual(registeredFromMisVentasState({
    registered: { number: '1', customer: 'Ana', total: 10 },
  }), { number: '1', customer: 'Ana', total: 10 });
});
