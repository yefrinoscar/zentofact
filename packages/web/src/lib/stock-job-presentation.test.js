import test from 'node:test';
import assert from 'node:assert/strict';
import {
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

  assert.equal(visibleStockJobStatus(job), 'outside_window');
  assert.match(stockJobDetail(job, LISTEN_FROM), /^No se descontó:/);
  assert.match(stockJobDetail(job, LISTEN_FROM), /anterior al inicio de descuentos/);
});

test('un pedido ya aplicado conserva el estado descontado aunque el webhook se repita', () => {
  const job = {
    status: 'done',
    attempts: 2,
    applied_units: 1,
    items: [{ stockState: 'applied' }],
    result: { applied: 0 },
  };

  assert.equal(visibleStockJobStatus(job), 'done');
  assert.equal(stockJobDetail(job, LISTEN_FROM), '1 u descontada');
  assert.equal(shouldShowStockJobAttempts(job), false);
});

test('el contador de intentos solo acompaña trabajos que aún requieren seguimiento', () => {
  assert.equal(shouldShowStockJobAttempts({ status: 'failed', attempts: 3 }), true);
  assert.equal(shouldShowStockJobAttempts({ status: 'pending', attempts: 2 }), true);
  assert.equal(shouldShowStockJobAttempts({ status: 'pending', attempts: 1 }), false);
});
