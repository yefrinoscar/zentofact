import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commissionHint,
  dailySeries,
  dayKeyLabel,
  paymentMethodLabel,
  paymentMixSlices,
  productivityStats,
  saleListRow,
  saleProductTitle,
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

test('la fila de venta muestra número, cliente, total, comisión, pago y fecha', () => {
  const row = saleListRow({
    externalOrderNumber: 'VTA-123',
    customer: { name: 'Lucía' },
    total: 85.5,
    metadata: { paymentMethod: 'yape_plin' },
    orderedAt: '2026-08-24T15:00:00Z',
  }, 10);
  assert.equal(row.number, 'VTA-123');
  assert.equal(row.customer, 'Lucía');
  assert.equal(row.product, '');
  assert.equal(row.productTitle, '');
  assert.equal(row.imageUrl, null);
  assert.equal(row.total, 85.5);
  assert.equal(row.commission, 8.55);
  assert.equal(row.payment, 'Yape / Plin');
  assert.ok(row.date);
});

test('la fila de venta toma el producto y la foto del primer ítem', () => {
  const row = saleListRow({
    externalOrderNumber: '2609050246',
    customer: { name: 'Alexander' },
    total: 25,
    items: [
      { name: 'Manta térmica AG301', sku: 'AG301', quantity: 1, imageUrl: '/seed/ag301.svg' },
      { name: 'Bolso HOG025', sku: 'HOG025', quantity: 1, imageUrl: '/seed/hog025.svg' },
    ],
  });
  assert.equal(row.product, 'Manta térmica AG301');
  assert.equal(row.productTitle, 'Manta térmica AG301 y 1 más');
  assert.equal(row.sku, 'AG301');
  assert.equal(row.imageUrl, '/seed/ag301.svg');
  assert.equal(row.extraCount, 1);
});

test('el título del producto nombra las líneas extra en palabras del vendedor', () => {
  assert.equal(saleProductTitle('Manta térmica'), 'Manta térmica');
  assert.equal(saleProductTitle('Manta térmica', 2), 'Manta térmica y 2 más');
  assert.equal(saleProductTitle(''), '');
});

test('un método de pago desconocido queda como Sin dato', () => {
  assert.equal(paymentMethodLabel(''), 'Sin dato');
  assert.equal(paymentMethodLabel('efectivo'), 'Efectivo');
});

test('la ayuda de comisión dice el porcentaje en palabras del vendedor', () => {
  assert.equal(commissionHint(5), '5% de lo vendido.');
  assert.equal(commissionHint(7.5), '7,5% de lo vendido.');
  assert.equal(commissionHint(0), 'Sin comisión configurada.');
  assert.equal(commissionHint(undefined), 'Sin comisión configurada.');
});

test('la serie diaria descarta fechas inválidas y normaliza números', () => {
  const series = dailySeries({
    daily: [
      { date: '2026-08-24', orders: '2', total: '200', commission: '20' },
      { date: 'ayer', orders: 1, total: 1, commission: 1 },
      { date: '2026-08-25', orders: 0, total: 0, commission: 0 },
    ],
  });
  assert.deepEqual(series, [
    { date: '2026-08-24', orders: 2, total: 200, commission: 20 },
    { date: '2026-08-25', orders: 0, total: 0, commission: 0 },
  ]);
  assert.deepEqual(dailySeries(undefined), []);
});

test('las estadísticas de productividad resumen días con venta, ritmo y ticket', () => {
  const stats = productivityStats([
    { date: '2026-08-22', orders: 0, total: 0, commission: 0 },
    { date: '2026-08-23', orders: 2, total: 200, commission: 20 },
    { date: '2026-08-24', orders: 0, total: 0, commission: 0 },
    { date: '2026-08-25', orders: 4, total: 100, commission: 10 },
  ]);
  assert.equal(stats.days, 4);
  assert.equal(stats.activeDays, 2);
  assert.equal(stats.orders, 6);
  assert.equal(stats.total, 300);
  assert.equal(stats.commission, 30);
  assert.equal(stats.ordersPerActiveDay, 3);
  assert.equal(stats.averageTicket, 50);
  assert.equal(stats.bestDay?.date, '2026-08-23');
});

test('sin ventas las estadísticas quedan en cero y sin mejor día', () => {
  const stats = productivityStats([{ date: '2026-08-22', orders: 0, total: 0, commission: 0 }]);
  assert.equal(stats.activeDays, 0);
  assert.equal(stats.ordersPerActiveDay, 0);
  assert.equal(stats.averageTicket, 0);
  assert.equal(stats.bestDay, null);
});

test('el mix de pago ordena por monto, etiqueta y calcula participación', () => {
  const slices = paymentMixSlices([
    { method: 'yape_plin', orders: 1, total: 100 },
    { method: 'efectivo', orders: 3, total: 300 },
    { method: 'sin_dato', orders: 0, total: 0 },
  ]);
  assert.deepEqual(slices.map((slice) => slice.key), ['efectivo', 'yape_plin']);
  assert.equal(slices[0].label, 'Efectivo');
  assert.equal(slices[0].share, 0.75);
  assert.equal(slices[1].share, 0.25);
});

test('la etiqueta de día no se desplaza por zona horaria', () => {
  assert.match(dayKeyLabel('2026-08-24'), /^24 ago/);
  assert.match(dayKeyLabel('2026-01-01'), /^1 ene/);
  assert.equal(dayKeyLabel('nope'), '');
});

test('la fila usa la comisión de los productos calculada por el servidor, incluso cero', () => {
  assert.equal(saleListRow({ total: 200, commission: 15 }, 0).commission, 15);
  assert.equal(saleListRow({ total: 200, commission: 0 }, 10).commission, 0);
});
