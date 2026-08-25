import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOptimisticSale,
  flashFromMisVentasState,
  humanizeSaleError,
  saleFailedFlash,
  saleRegisteredFlash,
} from './sale-feedback.ts';

test('saleRegisteredFlash lleva título, detalle con monto y pista clara', () => {
  const flash = saleRegisteredFlash({
    number: '2608251234',
    customer: 'Ana Pérez',
    total: 299.9,
  });
  assert.equal(flash.tone, 'success');
  assert.equal(flash.title, 'Venta lista');
  assert.match(flash.detail, /2608251234/);
  assert.match(flash.detail, /Ana Pérez/);
  assert.match(flash.detail, /299/);
  assert.equal(flash.hint, 'Ya aparece en tu lista de hoy.');
});

test('humanizeSaleError oculta SQL y deja pasar validaciones cortas', () => {
  assert.match(
    humanizeSaleError('Failed query: column "items_status" of relation "orders" does not exist'),
    /Inténtalo de nuevo/,
  );
  assert.equal(humanizeSaleError('Escribe el nombre del cliente.'), 'Escribe el nombre del cliente.');
  assert.match(humanizeSaleError(''), /Algo falló/);
});

test('saleFailedFlash usa mensaje operativo', () => {
  const flash = saleFailedFlash('Failed query: boom');
  assert.equal(flash.tone, 'error');
  assert.equal(flash.title, 'No se guardó la venta');
  assert.doesNotMatch(flash.detail, /Failed query/i);
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
  assert.equal(next.today?.total, 150);
  assert.equal(next.today?.commission, 15);
  assert.equal(next.month?.orders, 2);
});

test('flashFromMisVentasState acepta string legacy y objeto', () => {
  const fromString = flashFromMisVentasState({ registered: 'ABC' });
  assert.equal(fromString?.title, 'Venta lista');
  assert.match(fromString?.detail || '', /ABC/);

  const fromObject = flashFromMisVentasState({
    registered: { number: '1', customer: 'Ana', total: 10 },
  });
  assert.match(fromObject?.detail || '', /Ana/);
});
