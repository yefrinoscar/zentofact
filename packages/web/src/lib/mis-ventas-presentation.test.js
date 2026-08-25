import test from 'node:test';
import assert from 'node:assert/strict';
import {
  paymentMethodLabel,
  saleListRow,
  salespersonKpis,
} from './mis-ventas-presentation.ts';

test('la comisión estimada usa el porcentaje sobre el total de ventas', () => {
  assert.deepEqual(salespersonKpis({
    today: { orders: 2, total: 200, commission: 20 },
    month: { orders: 8, total: 1000, commission: 100 },
  }), [
    { period: 'Hoy', orders: 2, total: 200, commission: 20 },
    { period: 'Mes', orders: 8, total: 1000, commission: 100 },
  ]);
});

test('la fila de venta muestra número, cliente, total, pago y fecha', () => {
  const row = saleListRow({
    externalOrderNumber: 'VTA-123',
    customer: { name: 'Lucía' },
    total: 85.5,
    metadata: { paymentMethod: 'yape_plin' },
    orderedAt: '2026-08-24T15:00:00Z',
  });
  assert.equal(row.number, 'VTA-123');
  assert.equal(row.customer, 'Lucía');
  assert.equal(row.total, 85.5);
  assert.equal(row.payment, 'Yape / Plin');
  assert.ok(row.date);
});

test('un método de pago desconocido queda como Sin dato', () => {
  assert.equal(paymentMethodLabel(''), 'Sin dato');
  assert.equal(paymentMethodLabel('efectivo'), 'Efectivo');
});
