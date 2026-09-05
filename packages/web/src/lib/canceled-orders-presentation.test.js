import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cancellationKind,
  cancellationKindLabel,
  stockApprovalLabel,
  creditNoteAction,
  documentKindLabel,
  documentTag,
  parseCanceledDateRange,
} from './canceled-orders-presentation.ts';

test('distingue cancelada de devuelta', () => {
  assert.equal(cancellationKind({ fulfillmentStatus: 'cancelled' }), 'cancelled');
  assert.equal(cancellationKind({ fulfillmentStatus: 'returned' }), 'returned');
  assert.equal(cancellationKind({ fulfillmentStatus: 'delivered', stockApproval: 'pending' }), 'returned');
  assert.equal(cancellationKindLabel('cancelled'), 'Cancelada');
  assert.equal(cancellationKindLabel('returned'), 'Devuelta');
  assert.equal(stockApprovalLabel('pending'), 'Por aprobar');
  assert.equal(stockApprovalLabel('approved'), 'Stock aprobado');
  assert.equal(stockApprovalLabel('not_required'), null);
});

test('describe el comprobante y la nota de crédito como en Falabella', () => {
  assert.equal(documentKindLabel('boleta'), 'Boleta');
  assert.equal(documentKindLabel('factura'), 'Factura');
  assert.deepEqual(documentTag('boleta', 'B001-000648'), { label: 'Boleta', number: 'B001-000648' });
  assert.deepEqual(documentTag('factura', 'F001-000010'), { label: 'Factura', number: 'F001-000010' });
  assert.deepEqual(documentTag('boleta', '  '), { label: 'Boleta', number: null });
  assert.equal(documentTag('none'), null);
  assert.deepEqual(
    creditNoteAction({ creditNoteNumber: 'B001-000104', documentNumber: 'B001-001108', documentKind: 'boleta' }),
    { tone: 'done', label: 'NC', number: 'B001-000104' },
  );
  assert.deepEqual(
    creditNoteAction({ documentNumber: 'F001-000010', documentKind: 'factura' }),
    { tone: 'pending', label: 'Sin NC', number: null },
  );
  assert.deepEqual(
    creditNoteAction({ documentNumber: 'B001-001090', documentKind: 'boleta' }),
    { tone: 'pending', label: 'Sin NC', number: null },
  );
  assert.deepEqual(creditNoteAction({ documentKind: 'boleta' }), { tone: 'pending', label: 'Sin NC', number: null });
  assert.deepEqual(creditNoteAction({}), { tone: 'none', label: 'Sin documento', number: null });
});

test('el rango por defecto cubre los últimos 30 días', () => {
  const range = parseCanceledDateRange(new URLSearchParams());
  assert.match(range.from, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(range.to, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(range.from <= range.to, true);
  const explicit = parseCanceledDateRange(new URLSearchParams('from=2026-08-01&to=2026-08-31'));
  assert.deepEqual(explicit, { from: '2026-08-01', to: '2026-08-31' });
});
