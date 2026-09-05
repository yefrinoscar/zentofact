import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isListableStockJob,
  shouldShowStockJobAttempts,
  stockJobDetail,
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

test('un pedido cancelado no conserva la reserva del job después de reintegrar stock', () => {
  const job = {
    status: 'done',
    ordered_at: '2026-09-04T16:10:00.000Z',
    reserved_units: 0,
    applied_units: 0,
    items: [{ stockState: 'reversed' }],
    result: { reserved: 1, applied: 0 },
  };

  assert.equal(visibleStockJobStatus(job, LISTEN_FROM), 'reversed');
  assert.equal(stockJobDetail(job, LISTEN_FROM), 'Stock reintegrado');
  assert.equal(isListableStockJob(job, LISTEN_FROM), true);
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
});

test('el contador de intentos solo acompaña trabajos que aún requieren seguimiento', () => {
  assert.equal(shouldShowStockJobAttempts({ status: 'failed', attempts: 3 }), true);
  assert.equal(shouldShowStockJobAttempts({ status: 'pending', attempts: 2 }), true);
  assert.equal(shouldShowStockJobAttempts({ status: 'pending', attempts: 1 }), false);
});
