const assert = require('node:assert/strict');
const test = require('node:test');

const {
  creditNoteIssueDatePolicy,
  resolveCreditNoteBatchIssueDate,
  resolveCreditNoteIssueDate,
  validateCreditNoteIssueDateForSend,
} = require('../dist/utils/credit-note-issue-date.js');

test('sugiere el último día del mes anterior solo durante los primeros dos días', () => {
  assert.deepEqual(creditNoteIssueDatePolicy({
    today: '2026-09-01',
    affectedDocumentDates: ['2026-08-31'],
  }), {
    today: '2026-09-01',
    sendWindowStart: '2026-08-29',
    currentMonthStart: '2026-09-01',
    previousMonthEnd: '2026-08-31',
    earliestDate: '2026-08-31',
    defaultDate: '2026-08-31',
    latestAffectedDocumentDate: '2026-08-31',
    canUsePreviousMonthEnd: true,
  });
  assert.equal(creditNoteIssueDatePolicy({
    today: '2026-09-02',
    affectedDocumentDates: ['2026-08-30'],
  }).defaultDate, '2026-08-31');
  assert.equal(creditNoteIssueDatePolicy({
    today: '2026-09-03',
    affectedDocumentDates: ['2026-08-31'],
  }).defaultDate, '2026-09-03');
  assert.equal(creditNoteIssueDatePolicy({ today: '2026-09-04' }).defaultDate, '2026-09-04');
});

test('resuelve correctamente el último día de febrero', () => {
  assert.equal(creditNoteIssueDatePolicy({
    today: '2024-03-01',
    affectedDocumentDates: ['2024-02-29'],
  }).defaultDate, '2024-02-29');
  assert.equal(creditNoteIssueDatePolicy({
    today: '2025-03-02',
    affectedDocumentDates: ['2025-02-27'],
  }).defaultDate, '2025-02-28');
});

test('acepta una nota del 31 de agosto solo hasta el 2 de septiembre', () => {
  assert.equal(resolveCreditNoteIssueDate('2026-08-31', {
    today: '2026-09-01',
    affectedDocumentDates: ['2026-08-31'],
  }), '2026-08-31');
  assert.equal(resolveCreditNoteIssueDate('2026-08-31', {
    today: '2026-09-02',
    affectedDocumentDates: ['2026-08-30'],
  }), '2026-08-31');
  assert.throws(
    () => resolveCreditNoteIssueDate('2026-08-31', {
      today: '2026-09-03',
      affectedDocumentDates: ['2026-08-31'],
    }),
    /primeros 2 días/,
  );
});

test('rechaza una fecha vencida, futura o inexistente', () => {
  assert.throws(
    () => resolveCreditNoteIssueDate('2026-09-01', { today: '2026-09-05' }),
    /hasta 3 días calendario/,
  );
  assert.throws(
    () => resolveCreditNoteIssueDate('2026-09-02', { today: '2026-09-01' }),
    /no puede ser futura/,
  );
  assert.throws(
    () => resolveCreditNoteIssueDate('2026-02-30', { today: '2026-03-01' }),
    /formato AAAA-MM-DD/,
  );
});

test('la fecha automática usa la regla del cruce de mes', () => {
  assert.equal(resolveCreditNoteIssueDate(undefined, {
    today: '2026-09-02',
    affectedDocumentDates: ['2026-08-30'],
  }), '2026-08-31');
  assert.equal(resolveCreditNoteIssueDate(undefined, {
    today: '2026-09-03',
    affectedDocumentDates: ['2026-08-31'],
  }), '2026-09-03');
  assert.equal(resolveCreditNoteIssueDate(undefined, { today: '2026-09-04' }), '2026-09-04');
});

test('vuelve a validar la fecha justo antes del envío', () => {
  assert.equal(validateCreditNoteIssueDateForSend('2026-08-31', {
    today: '2026-09-02',
    affectedDocumentDates: ['2026-08-31'],
  }), '2026-08-31');
  assert.throws(
    () => validateCreditNoteIssueDateForSend('2026-08-31', {
      today: '2026-09-03',
      affectedDocumentDates: ['2026-08-31'],
    }),
    /primeros 2 días/,
  );
  assert.throws(
    () => validateCreditNoteIssueDateForSend('', { today: '2026-09-01' }),
    /no tiene una fecha/,
  );
});

test('nunca fecha la nota antes que la boleta o factura afectada', () => {
  assert.equal(
    resolveCreditNoteIssueDate(undefined, {
      today: '2026-09-02',
      affectedDocumentDates: ['2026-08-31'],
    }),
    '2026-08-31',
  );
  assert.equal(
    resolveCreditNoteIssueDate(undefined, {
      today: '2026-09-02',
      affectedDocumentDates: ['2026-09-01'],
    }),
    '2026-09-02',
  );
  assert.equal(
    resolveCreditNoteIssueDate(undefined, {
      today: '2026-09-02',
      affectedDocumentDates: ['2026-09-02'],
    }),
    '2026-09-02',
  );
  assert.throws(
    () => resolveCreditNoteIssueDate('2026-08-31', {
      today: '2026-09-02',
      affectedDocumentDates: ['2026-09-01'],
    }),
    /no puede ser anterior al comprobante afectado/,
  );
});

test('el 2 solo lleva al 31 las boletas del 30 o 31', () => {
  const cases = [
    { affected: '2026-08-15', earliest: '2026-09-01', suggested: '2026-09-02' },
    { affected: '2026-08-29', earliest: '2026-09-01', suggested: '2026-09-02' },
    { affected: '2026-08-30', earliest: '2026-08-31', suggested: '2026-08-31' },
    { affected: '2026-08-31', earliest: '2026-08-31', suggested: '2026-08-31' },
    { affected: '2026-09-01', earliest: '2026-09-01', suggested: '2026-09-02' },
    { affected: '2026-09-02', earliest: '2026-09-02', suggested: '2026-09-02' },
  ];

  for (const expected of cases) {
    const policy = creditNoteIssueDatePolicy({
      today: '2026-09-02',
      affectedDocumentDates: [expected.affected],
    });
    assert.equal(policy.earliestDate, expected.earliest, expected.affected);
    assert.equal(policy.defaultDate, expected.suggested, expected.affected);
  }

  assert.throws(
    () => resolveCreditNoteIssueDate('2026-08-31', {
      today: '2026-09-02',
      affectedDocumentDates: ['2026-08-29'],
    }),
    /30\/08 o 31\/08/,
  );
});

test('el 1 también lleva al mes anterior las boletas de los dos últimos días', () => {
  assert.equal(creditNoteIssueDatePolicy({
    today: '2026-09-01',
    affectedDocumentDates: ['2026-08-31'],
  }).defaultDate, '2026-08-31');
  assert.equal(creditNoteIssueDatePolicy({
    today: '2026-09-01',
    affectedDocumentDates: ['2026-08-30'],
  }).defaultDate, '2026-08-31');
  assert.equal(resolveCreditNoteIssueDate('2026-08-31', {
    today: '2026-09-01',
    affectedDocumentDates: ['2026-08-30'],
  }), '2026-08-31');
  assert.throws(
    () => resolveCreditNoteIssueDate('2026-08-31', {
      today: '2026-09-01',
      affectedDocumentDates: ['2026-08-29'],
    }),
    /30\/08 o 31\/08/,
  );
});

test('sin comprobante afectado nunca habilita una fecha del mes anterior', () => {
  const policy = creditNoteIssueDatePolicy({ today: '2026-09-02' });
  assert.equal(policy.canUsePreviousMonthEnd, false);
  assert.equal(policy.earliestDate, '2026-09-01');
  assert.equal(policy.defaultDate, '2026-09-02');
});

test('la anulación automática y el lote usan la misma fecha común', () => {
  assert.equal(resolveCreditNoteIssueDate(undefined, {
    today: '2026-09-01',
    affectedDocumentDates: ['2026-08-30'],
  }), '2026-08-31');

  assert.equal(resolveCreditNoteBatchIssueDate(undefined, {
    today: '2026-09-01',
    affectedDocumentDates: ['2026-08-30', '2026-08-31'],
  }), '2026-08-31');

  assert.equal(resolveCreditNoteBatchIssueDate(undefined, {
    today: '2026-09-01',
    affectedDocumentDates: ['2026-08-29', '2026-08-31'],
  }), '2026-09-01');

  assert.throws(
    () => resolveCreditNoteBatchIssueDate('2026-08-31', {
      today: '2026-09-01',
      affectedDocumentDates: ['2026-08-29', '2026-08-31'],
    }),
    /30\/08 o 31\/08/,
  );
});
