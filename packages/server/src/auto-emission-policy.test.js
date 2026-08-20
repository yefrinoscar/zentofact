import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JOB_KIND_CREDIT_NOTE,
  JOB_KIND_INVOICE,
  decideCreditNoteJob,
  isCreditNoteStatus,
  isReadyStatus,
  jobKindForStatus,
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
  assert.equal(isCreditNoteStatus('failed'), false);
  assert.equal(jobKindForStatus('pending'), null);
  assert.equal(jobKindForStatus('failed'), null);
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
