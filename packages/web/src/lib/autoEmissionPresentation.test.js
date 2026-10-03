import test from 'node:test';
import assert from 'node:assert/strict';
import { emissionNeedsReview, emissionSummary, discountDateParts } from './autoEmissionPresentation.ts';

const job = {
  status: 'failed', kind: 'credit_note', attempts: 1, last_error: null, result: null,
  boleta_numero: 'B001-000023', company_id: 7, document_date: '2026-06-04',
};

test('human-only document states require review even before six attempts', () => {
  for (const state of ['REVISION_MANUAL', 'ANULADO', 'REEMPLAZADO']) {
    assert.equal(emissionNeedsReview({ ...job, last_error: `Documento está ${state}` }), true);
  }
  assert.equal(emissionNeedsReview(job), false);
  assert.equal(emissionNeedsReview({ ...job, attempts: 6 }), true);
  assert.equal(emissionNeedsReview({ ...job, status: 'done', attempts: 562 }), false);
});

test('review text gives the next step without assuming why SUNAT needs review', () => {
  assert.equal(emissionSummary({ ...job, last_error: 'Está REVISION_MANUAL' }),
    'Verifica el estado en SUNAT antes de emitir otro documento.');
  assert.equal(emissionSummary({ ...job, last_error: 'Error de conexión' }), 'Error de conexión');
});

test('discount dates use Lima time and never invent a date for missing movements', () => {
  assert.equal(discountDateParts(null), null);
  assert.equal(discountDateParts('invalid'), null);
  const parts = discountDateParts('2026-10-03T02:45:00Z');
  assert.match(parts.date, /02/);
  assert.equal(parts.time, '21:45');
});
