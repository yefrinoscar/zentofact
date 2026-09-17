import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canceledListQuery,
  cancellationKind,
  cancellationKindLabel,
  stockApprovalLabel,
  creditNoteAction,
  documentKindLabel,
  documentTag,
  parseCanceledDateRange,
  extraProductsLabel,
  returnOutcomeLabel,
  returnDecisionSummary,
  returnDecisionHelper,
  returnLineDecisionLabel,
  setReturnLineStock,
  setReturnUnit,
  returnUnits,
  returnUnitLabel,
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

test('la lista de devoluciones pide solo pedidos devueltos', () => {
  assert.deepEqual(canceledListQuery(), { kind: 'returned', approval: undefined });
  assert.deepEqual(canceledListQuery('returned'), { kind: 'returned', approval: undefined });
  assert.deepEqual(canceledListQuery('pending_approval'), { kind: 'returned', approval: 'pending' });
});

test('ofrece ver todos los productos y resume stock contra merma', () => {
  assert.equal(extraProductsLabel(1), null);
  assert.equal(extraProductsLabel(2), 'Ver 2 productos');
  assert.equal(extraProductsLabel(3), 'Ver 3 productos');
  assert.equal(extraProductsLabel(4), 'Ver 4 productos');
  assert.equal(returnOutcomeLabel([{ approvalStatus: 'approved', stockQuantity: 2, mermaQuantity: 0 }]), null);
  assert.equal(returnOutcomeLabel([{ approvalStatus: 'approved', stockQuantity: 0, mermaQuantity: 2 }]), 'Merma');
  assert.equal(returnOutcomeLabel([{ approvalStatus: 'approved', stockQuantity: 1, mermaQuantity: 1 }]), 'Stock y merma');
  const split = setReturnLineStock({ orderItemId: 9, quantity: 3, stockQuantity: 3, mermaQuantity: 0 }, 1);
  assert.deepEqual(split, {
    orderItemId: 9,
    quantity: 3,
    stockQuantity: 1,
    mermaQuantity: 2,
    units: ['stock', 'merma', 'merma'],
  });
  assert.deepEqual(returnDecisionSummary([split]), { stock: 1, merma: 2, balanced: true });
  assert.equal(returnDecisionHelper({ stock: 1, merma: 2 }), '1 u a stock. 2 u a merma.');
  assert.equal(returnDecisionHelper({ stock: 0, merma: 0 }), 'Marca stock o merma en cada unidad.');
  assert.equal(
    returnLineDecisionLabel({ stockQuantity: 1, mermaQuantity: 1 }),
    '1 u a stock · 1 u a merma',
  );
  const twoUnits = { orderItemId: 9, quantity: 2, stockQuantity: 2, mermaQuantity: 0 };
  const mermaSecond = setReturnUnit(twoUnits, 1, 'merma');
  assert.deepEqual(returnUnits(mermaSecond), ['stock', 'merma']);
  assert.equal(mermaSecond.stockQuantity, 1);
  assert.equal(mermaSecond.mermaQuantity, 1);
  assert.equal(returnUnitLabel(0, 2), '1 de 2');
  assert.equal(returnUnitLabel(1, 2), '2 de 2');
  assert.deepEqual(setReturnLineStock(twoUnits, 0).units, ['merma', 'merma']);
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
