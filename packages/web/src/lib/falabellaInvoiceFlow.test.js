import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAcceptedSalesDocument,
  matchesInvoiceFlowFilter,
  needsSalesDocumentReview,
  shouldIncludeInFinancialTotals,
  summarizeIssuedSalesDocuments,
  summarizeDocumentRows,
} from './falabellaInvoiceFlow.ts';

test('con documento incluye órdenes en revisión sin sacarlas de revisión', () => {
  const rows = [
    { bucket: 'has_document', hasDocument: true, total: 100 },
    { bucket: 'review', hasDocument: true, total: 50 },
    { bucket: 'review', hasDocument: false, total: 25 },
  ];

  assert.deepEqual(summarizeDocumentRows(rows), { count: 2, amount: 150 });
  assert.deepEqual(
    rows.filter((row) => matchesInvoiceFlowFilter(row, 'has_document')),
    [rows[0], rows[1]],
  );
  assert.deepEqual(
    rows.filter((row) => matchesInvoiceFlowFilter(row, 'review')),
    [rows[1], rows[2]],
  );
});

test('emitido suma solo boletas y facturas aceptadas por SUNAT', () => {
  const rows = [
    {
      hasSalesDocument: true,
      salesDocumentKind: 'BOLETA',
      salesDocumentStatus: 'ACEPTADO',
      salesDocumentAmount: 100,
    },
    {
      hasSalesDocument: true,
      salesDocumentKind: 'BOLETA',
      salesDocumentStatus: 'RECHAZADO',
      salesDocumentAmount: 50,
    },
    {
      hasSalesDocument: true,
      salesDocumentKind: 'BOLETA',
      salesDocumentStatus: 'NO_ENVIADA',
      salesDocumentAmount: 25,
    },
    {
      hasSalesDocument: true,
      salesDocumentKind: 'FACTURA',
      salesDocumentStatus: 'aceptado',
      salesDocumentAmount: 30,
    },
    {
      hasSalesDocument: true,
      salesDocumentStatus: 'ACEPTADO',
      salesDocumentAmount: 10,
    },
  ];

  assert.deepEqual(summarizeIssuedSalesDocuments(rows), {
    boletas: { count: 1, amount: 100 },
    facturas: { count: 1, amount: 30 },
  });
  assert.equal(isAcceptedSalesDocument(rows[0]), true);
  assert.equal(isAcceptedSalesDocument(rows[1]), false);
  assert.equal(isAcceptedSalesDocument(rows[2]), false);
});

test('canceladas y devueltas solo cuentan si ya tienen documento', () => {
  assert.equal(shouldIncludeInFinancialTotals({
    statusKey: 'canceled',
    hasSalesDocument: false,
  }), false);
  assert.equal(shouldIncludeInFinancialTotals({
    statusKey: 'returned',
    hasSalesDocument: false,
  }), false);
  assert.equal(shouldIncludeInFinancialTotals({
    statusKey: 'cancelada',
    hasSalesDocument: true,
  }), true);
  assert.equal(shouldIncludeInFinancialTotals({
    statusKey: 'devuelta',
    hasSalesDocument: true,
  }), true);
  assert.equal(shouldIncludeInFinancialTotals({
    statusKey: 'delivered',
    hasSalesDocument: false,
  }), true);
});

test('documentos rechazados o no enviados quedan en revisión', () => {
  assert.equal(needsSalesDocumentReview({
    hasSalesDocument: true,
    salesDocumentStatus: 'RECHAZADO',
  }), true);
  assert.equal(needsSalesDocumentReview({
    hasSalesDocument: true,
    salesDocumentStatus: 'NO_ENVIADA',
  }), true);
  assert.equal(needsSalesDocumentReview({
    hasSalesDocument: true,
    salesDocumentStatus: 'ACEPTADO',
  }), false);
  assert.equal(needsSalesDocumentReview({
    hasSalesDocument: false,
    salesDocumentStatus: '',
  }), false);
});
