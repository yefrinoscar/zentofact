import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isListableStockJob,
  shouldShowStockJobAttempts,
  stockItemReason,
  stockJobDetail,
  stockJobFilterBucket,
  stockOrderStatusLabel,
  stockPreviewFooter,
  visibleStockJobStatus,
} from './stock-job-presentation.ts';

const LISTEN_FROM = '2026-09-03T17:00:00.000Z';

test('una venta anterior al corte no aparece como descontada', () => {
  const job = {
    status: 'done',
    ordered_at: '2026-09-02T18:30:38.000Z',
    items: [{ stockState: 'skipped_policy' }],
    result: { applied: 0, skipped: 0 },
  };

  assert.equal(visibleStockJobStatus(job, LISTEN_FROM), 'outside_window');
  assert.match(stockJobDetail(job, LISTEN_FROM), /^No se descontó:/);
  assert.match(stockJobDetail(job, LISTEN_FROM), /anterior al inicio de descuentos/);
  assert.equal(isListableStockJob(job, LISTEN_FROM), false);
});

test('una compra desde el corte sí aparece aunque se haya marcado skipped_policy', () => {
  const job = {
    status: 'done',
    ordered_at: '2026-09-03T17:30:00.000Z',
    items: [{ stockState: 'skipped_policy' }],
    result: { applied: 0, skipped: 1 },
  };

  assert.equal(visibleStockJobStatus(job, LISTEN_FROM), 'processed');
  assert.equal(isListableStockJob(job, LISTEN_FROM), true);
  assert.equal(stockJobDetail(job, LISTEN_FROM), '1 línea omitida');
});

test('un job sin fecha de compra no tapa la cola del período', () => {
  assert.equal(isListableStockJob({
    status: 'pending',
    ordered_at: null,
  }, LISTEN_FROM), false);
});

test('un pedido cancelado no se lee como procesado ni reservado', () => {
  const job = {
    status: 'done',
    ordered_at: '2026-09-04T16:10:00.000Z',
    order_status: 'cancelled',
    fulfillment_status: 'cancelled',
    reserved_units: 0,
    applied_units: 0,
    items: [{ stockState: 'reversed' }],
    result: { reserved: 1, applied: 0 },
  };

  assert.equal(visibleStockJobStatus(job, LISTEN_FROM), 'cancelled');
  assert.equal(stockJobDetail(job, LISTEN_FROM), 'Cancelado. No descuenta.');
  assert.equal(stockJobFilterBucket(job, LISTEN_FROM), 'cancelled');
  assert.equal(stockOrderStatusLabel({
    status: 'cancelled · cancelled',
    orderStatus: 'cancelled',
    fulfillmentStatus: 'cancelled',
  }), 'Cancelado');
  assert.equal(stockPreviewFooter({
    order: { orderStatus: 'cancelled', fulfillmentStatus: 'cancelled' },
    items: [{ stockState: 'reversed', quantity: 1 }],
    stock: { applied: 0 },
  }), 'Cancelado. No descuenta.');
  assert.equal(stockItemReason(
    { stockState: 'reversed', productId: 1, mainSku: 'G24N' },
    { orderStatus: 'cancelled', fulfillmentStatus: 'cancelled' },
  ), 'Volvió al almacén.');
});

test('un snapshot viejo de reserva no manda si el pedido ya está cancelado', () => {
  const job = {
    status: 'done',
    ordered_at: '2026-09-04T16:10:00.000Z',
    reserved_units: 0,
    applied_units: 0,
    items: [{ stockState: 'reversed' }],
    result: { reserved: 1 },
  };

  assert.equal(visibleStockJobStatus(job, LISTEN_FROM), 'cancelled');
  assert.equal(stockJobDetail(job, LISTEN_FROM), 'Cancelado. No descuenta.');
});

test('si el pedido se canceló y el stock no se soltó, el detalle lo dice', () => {
  const reserved = {
    status: 'done',
    ordered_at: '2026-09-04T16:10:00.000Z',
    order_status: 'cancelled',
    fulfillment_status: 'cancelled',
    reserved_units: 1,
    applied_units: 0,
    items: [{ stockState: 'pending' }],
    result: { reserved: 1 },
  };
  assert.equal(visibleStockJobStatus(reserved, LISTEN_FROM), 'cancelled');
  assert.equal(stockJobDetail(reserved, LISTEN_FROM), 'Cancelado, pero sigue reservado.');

  const applied = {
    ...reserved,
    reserved_units: 0,
    applied_units: 1,
    items: [{ stockState: 'applied' }],
    result: { applied: 1 },
  };
  assert.equal(stockJobDetail(applied, LISTEN_FROM), 'Cancelado, pero sigue descontado.');
});

test('un pedido ya aplicado conserva el estado descontado aunque el webhook se repita', () => {
  const job = {
    status: 'done',
    ordered_at: '2026-09-03T18:00:00.000Z',
    attempts: 2,
    applied_units: 1,
    items: [{ stockState: 'applied' }],
    result: { applied: 0 },
  };

  assert.equal(visibleStockJobStatus(job, LISTEN_FROM), 'done');
  assert.equal(stockJobDetail(job, LISTEN_FROM), '1 u descontada');
  assert.equal(shouldShowStockJobAttempts(job), false);
  assert.equal(isListableStockJob(job, LISTEN_FROM), true);
  assert.equal(stockJobFilterBucket(job, LISTEN_FROM), 'done');
});

test('el contador de intentos solo acompaña trabajos que aún requieren seguimiento', () => {
  assert.equal(shouldShowStockJobAttempts({ status: 'failed', attempts: 3 }), true);
  assert.equal(shouldShowStockJobAttempts({ status: 'pending', attempts: 2 }), true);
  assert.equal(shouldShowStockJobAttempts({ status: 'pending', attempts: 1 }), false);
});
