import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchesInvoiceFlowFilter,
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
