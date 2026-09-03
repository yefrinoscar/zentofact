import test from 'node:test';
import assert from 'node:assert/strict';
import {
  constrainCreditNoteIssueDate,
  creditNoteIssueDatePolicy,
} from './creditNoteIssueDate.ts';

test('un lote pierde agosto si una boleta no es del 30 o 31', () => {
  const policy = creditNoteIssueDatePolicy({
    today: '2026-09-02',
    affectedDocumentDates: ['2026-08-29', '2026-08-31'],
  });

  assert.equal(policy.earliestDate, '2026-09-01');
  assert.equal(policy.defaultDate, '2026-09-02');
  assert.equal(constrainCreditNoteIssueDate('2026-08-31', policy), '2026-09-02');
});

test('una boleta del 30 o 31 de agosto conserva agosto cuando el plazo lo permite', () => {
  const fromDay30 = creditNoteIssueDatePolicy({
    today: '2026-09-02',
    affectedDocumentDates: ['2026-08-30'],
  });
  const fromDay31 = creditNoteIssueDatePolicy({
    today: '2026-09-02',
    affectedDocumentDates: ['2026-08-31'],
  });

  assert.equal(fromDay30.earliestDate, '2026-08-31');
  assert.equal(fromDay30.defaultDate, '2026-08-31');
  assert.equal(fromDay31.earliestDate, '2026-08-31');
  assert.equal(fromDay31.defaultDate, '2026-08-31');
});

test('el día 1 también permite agosto para una boleta del 30', () => {
  const policy = creditNoteIssueDatePolicy({
    today: '2026-09-01',
    affectedDocumentDates: ['2026-08-30'],
  });

  assert.equal(policy.earliestDate, '2026-08-31');
  assert.equal(policy.defaultDate, '2026-08-31');
});
