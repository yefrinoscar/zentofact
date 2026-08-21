import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveIncrementalOrderWindow, resolveOrderBackfillWindow } from './order-sync-policy.js';

test('la primera sincronización cubre los cinco días calendario de Lima', () => {
  assert.deepEqual(resolveIncrementalOrderWindow({
    now: '2026-08-21T18:30:00.000Z',
  }), {
    from: '2026-08-17T05:00:00.000Z',
    to: '2026-08-21T18:29:00.000Z',
  });
});

test('el cursor usa diez minutos de solapamiento sin salir de los cinco días', () => {
  assert.deepEqual(resolveIncrementalOrderWindow({
    now: '2026-08-21T18:30:00.000Z',
    cursor: '2026-08-21T18:00:00.000Z',
  }), {
    from: '2026-08-21T17:50:00.000Z',
    to: '2026-08-21T18:29:00.000Z',
  });
  assert.equal(resolveIncrementalOrderWindow({
    now: '2026-08-21T18:30:00.000Z',
    cursor: '2026-08-01T00:00:00.000Z',
  }).from, '2026-08-17T05:00:00.000Z');
});

test('el backfill manual acepta un rango acotado de días de Lima', () => {
  assert.deepEqual(resolveOrderBackfillWindow({ from: '2026-08-01', to: '2026-08-03' }), {
    from: '2026-08-01T05:00:00.000Z',
    to: '2026-08-04T04:59:59.999Z',
  });
  assert.throws(
    () => resolveOrderBackfillWindow({ from: '2026-01-01', to: '2026-08-01' }),
    /máximo 31 días/,
  );
});
