import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JOB_KIND_CREDIT_NOTE,
  JOB_KIND_INVOICE,
  decideCreditNoteJob,
  decideExistingDocumentJob,
  creditNoteReconciliationOutcome,
  sweepDocumentAction,
  isCreditNoteStatus,
  isPartialCreditNoteStatus,
  isReadyStatus,
  jobKindForStatus,
  reconciliationJobOutcome,
} from './auto-emission-policy.js';

const MIN = new Date('2026-07-01T00:00:00+00:00');
const boleta = { id: 11, numeroCompleto: 'B001-000580', estadoSunat: 'ACEPTADO', total: 7 };
const factura = { id: 22, numeroCompleto: 'F001-000010', estadoSunat: 'ACEPTADO', total: 120 };
const creditNote = { id: 33, numeroCompleto: 'BC01-000012', estadoSunat: 'ACEPTADO' };

test('solo ready_to_ship/shipped/delivered encolan comprobante', () => {
  assert.equal(jobKindForStatus('ready_to_ship'), JOB_KIND_INVOICE);
  assert.equal(jobKindForStatus('shipped'), JOB_KIND_INVOICE);
  assert.equal(jobKindForStatus('delivered'), JOB_KIND_INVOICE);
  assert.equal(isReadyStatus('pending'), false);
});

test('cancelada o devuelta encolan nota de crédito, no boleta', () => {
  assert.equal(jobKindForStatus('canceled'), JOB_KIND_CREDIT_NOTE);
  assert.equal(jobKindForStatus('cancelled'), JOB_KIND_CREDIT_NOTE);
  assert.equal(jobKindForStatus('cancelada'), JOB_KIND_CREDIT_NOTE);
  assert.equal(jobKindForStatus('returned'), JOB_KIND_CREDIT_NOTE);
  assert.equal(jobKindForStatus('devuelta'), JOB_KIND_CREDIT_NOTE);
  assert.equal(jobKindForStatus('canceled|canceled'), JOB_KIND_CREDIT_NOTE);
  assert.equal(jobKindForStatus('canceled|returned'), JOB_KIND_CREDIT_NOTE);
  assert.equal(isCreditNoteStatus('failed'), false);
  assert.equal(jobKindForStatus('pending'), null);
  assert.equal(jobKindForStatus('failed'), null);
});

test('un ítem cancelado o devuelto junto a otro vigente no anula el comprobante entero', () => {
  assert.equal(isPartialCreditNoteStatus('delivered|canceled'), true);
  assert.equal(isPartialCreditNoteStatus('shipped|returned'), true);
  assert.equal(isPartialCreditNoteStatus('delivered|returned'), true);
  assert.equal(isCreditNoteStatus('delivered|canceled'), false);
  assert.equal(jobKindForStatus('delivered|canceled'), null);
  assert.equal(jobKindForStatus('shipped|canceled'), null);
  assert.equal(jobKindForStatus('delivered|returned'), null);
  const decided = decideCreditNoteJob({ status: 'delivered|canceled', boleta });
  assert.equal(decided.action, 'skip');
  assert.match(decided.result, /mixto/);
});

test('sin boleta ni factura aceptada no corresponde nota de crédito', () => {
  const decided = decideCreditNoteJob({ status: 'canceled' });
  assert.deepEqual(decided, {
    action: 'skip',
    result: 'no hay documento emitido; no corresponde nota de crédito',
  });
});

test('boleta aceptada de una cancelada se anula con nota de crédito', () => {
  const decided = decideCreditNoteJob({ status: 'canceled', boleta });
  assert.equal(decided.action, 'emit');
  assert.equal(decided.source, 'boleta');
  assert.equal(decided.documentId, 11);
  assert.equal(decided.boletaNumero, 'B001-000580');
});

test('devolución con factura aceptada también emite nota de crédito', () => {
  const decided = decideCreditNoteJob({ status: 'returned', factura });
  assert.equal(decided.action, 'emit');
  assert.equal(decided.source, 'factura');
  assert.equal(decided.documentId, 22);
});

test('si ya tiene nota de crédito aceptada el job queda hecho', () => {
  const decided = decideCreditNoteJob({ status: 'canceled', boleta, creditNote });
  assert.equal(decided.action, 'done');
  assert.match(decided.result, /ya tenía nota de crédito BC01-000012/);
});

test('documento de S/ 0 no genera nota de crédito', () => {
  const decided = decideCreditNoteJob({
    status: 'canceled',
    boleta: { ...boleta, total: 0 },
  });
  assert.equal(decided.action, 'skip');
  assert.match(decided.result, /S\/ 0/);
});

test('boleta sin aceptar no se anula a ciegas', () => {
  const decided = decideCreditNoteJob({
    status: 'canceled',
    boleta: { ...boleta, estadoSunat: 'PENDIENTE' },
  });
  assert.equal(decided.action, 'fail');
  assert.match(decided.result, /PENDIENTE/);
});

test('una lista para enviar no pide nota de crédito todavía', () => {
  const decided = decideCreditNoteJob({ status: 'ready_to_ship', boleta });
  assert.equal(decided.action, 'retry');
});

test('simulación no envía la nota de crédito', () => {
  const decided = decideCreditNoteJob({ status: 'canceled', boleta, dryRun: true });
  assert.equal(decided.action, 'skip');
  assert.match(decided.result, /Simulación/);
});

test('órdenes anteriores a julio 2026 se omiten', () => {
  const decided = decideCreditNoteJob({
    status: 'canceled',
    boleta,
    orderDate: new Date('2026-06-30T12:00:00Z'),
    minOrderDate: MIN,
  });
  assert.equal(decided.action, 'skip');
  assert.match(decided.result, /fecha mínima/);
});

test('documento existente aceptado: el job termina sin volver a emitir', () => {
  const decided = decideExistingDocumentJob({ document: { numeroCompleto: 'B001-000580', estadoSunat: 'ACEPTADO' }, tipo: 'boleta' });
  assert.equal(decided.action, 'done');
  assert.equal(decided.boletaNumero, 'B001-000580');
});

test('documento existente sin aceptar se reconcilia con SUNAT; en simulación no se toca', () => {
  for (const estadoSunat of ['NO_CONFIRMADO', 'RECHAZADO', 'PENDIENTE', 'NO_ENCONTRADO', '']) {
    assert.equal(decideExistingDocumentJob({ document: { estadoSunat }, tipo: 'boleta' }).action, 'reconcile', estadoSunat);
  }
  assert.equal(decideExistingDocumentJob({ document: { estadoSunat: 'NO_CONFIRMADO' }, tipo: 'boleta', dryRun: true }).action, 'skip');
});

test('revisión manual, anulado o reemplazado nunca se reemiten automáticamente', () => {
  for (const estadoSunat of ['REVISION_MANUAL', 'ANULADO', 'REEMPLAZADO']) {
    const decided = decideExistingDocumentJob({ document: { numeroCompleto: 'B001-000580', estadoSunat }, tipo: 'boleta' });
    assert.equal(decided.action, 'fail', estadoSunat);
    assert.match(decided.result, /revisión manual/);
  }
});

test('reconciliado con número nuevo: se sube a Falabella el número que quedó activo', () => {
  const outcome = reconciliationJobOutcome(
    { success: true, reemitted: true, documentId: 902, numeroCompleto: 'B001-000602', replacedNumeroCompleto: 'B001-000580' },
    { tipo: 'boleta', document: boleta },
  );
  assert.equal(outcome.action, 'upload');
  assert.equal(outcome.documentId, 902);
  assert.equal(outcome.numeroCompleto, 'B001-000602');
  assert.match(outcome.note, /reemplaza a B001-000580/);
});

test('recuperado como aceptado: se sube el mismo documento', () => {
  const outcome = reconciliationJobOutcome(
    { success: true, reemitted: false, documentId: 11, numeroCompleto: 'B001-000580' },
    { tipo: 'boleta', document: boleta },
  );
  assert.equal(outcome.action, 'upload');
  assert.equal(outcome.documentId, 11);
});

test('revisión manual detiene el job; lo incierto se reintenta más tarde', () => {
  assert.equal(reconciliationJobOutcome({ success: false, blocked: true, manualReview: true, error_code: 'SUNAT_MANUAL_REVIEW' }, { tipo: 'boleta', document: boleta }).action, 'fail');
  assert.equal(reconciliationJobOutcome({ success: false, blocked: true, error_code: 'DOCUMENT_CLOSED' }, { tipo: 'boleta', document: boleta }).action, 'fail');
  for (const error_code of ['SUNAT_STATUS_CHECK_FAILED', 'SUNAT_STATUS_PENDING', 'REEMISSION_IN_PROGRESS', 'soap-env:Client.0130']) {
    assert.equal(reconciliationJobOutcome({ success: false, error_code }, { tipo: 'boleta', document: boleta }).action, 'retry', error_code);
  }
});

test('nota de crédito sin confirmar se reconcilia; nunca se emite otra a ciegas', () => {
  const base = { status: 'canceled', orderDate: new Date('2026-08-01T00:00:00Z'), minOrderDate: MIN, boleta };
  for (const estadoSunat of ['NO_CONFIRMADO', 'ENVIANDO', 'PENDIENTE', 'NO_ENCONTRADO']) {
    const decided = decideCreditNoteJob({ ...base, creditNote: { id: 33, numeroCompleto: 'BC01-000012', estadoSunat } });
    assert.equal(decided.action, 'reconcile', estadoSunat);
    assert.equal(decided.creditNoteId, 33);
  }
  assert.equal(decideCreditNoteJob({ ...base, creditNote: { id: 33, estadoSunat: 'REVISION_MANUAL' } }).action, 'fail');
  assert.equal(decideCreditNoteJob({ ...base, creditNote: { id: 33, estadoSunat: 'NO_CONFIRMADO' }, dryRun: true }).action, 'skip');
});

test('resultado de reconciliar una nota de crédito', () => {
  assert.equal(creditNoteReconciliationOutcome({ success: true, numeroCompleto: 'BC01-000012' }).action, 'done');
  // Rechazada: se descartó; el siguiente intento emite una nueva.
  assert.equal(creditNoteReconciliationOutcome({ success: false, rejected: true, error_code: 'SUNAT_REJECTED' }).action, 'retry');
  assert.equal(creditNoteReconciliationOutcome({ success: false, blocked: true, error_code: 'SUNAT_STATUS_CHECK_FAILED' }).action, 'retry');
  assert.equal(creditNoteReconciliationOutcome({ success: false, manualReview: true }).action, 'fail');
});

test('barrido: espera al job activo, reencola el fallido y en otro caso solo consulta', () => {
  const doc = { orderNumber: '3248821186' };
  assert.equal(sweepDocumentAction({ document: doc, job: { status: 'processing' }, companyEnabled: true }), 'wait');
  assert.equal(sweepDocumentAction({ document: doc, job: { status: 'pending' }, companyEnabled: true }), 'wait');
  assert.equal(sweepDocumentAction({ document: doc, job: { status: 'failed' }, companyEnabled: true }), 'requeue');
  // Empresa pausada (por ejemplo por el centinela de serie): solo lectura.
  assert.equal(sweepDocumentAction({ document: doc, job: { status: 'failed' }, companyEnabled: false }), 'refresh');
  assert.equal(sweepDocumentAction({ document: { orderNumber: null }, job: null, companyEnabled: true }), 'refresh');
});
