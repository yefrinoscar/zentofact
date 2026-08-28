import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateDocumentLabel,
  generateDocumentPath,
  invoicePrefillFromOrder,
  pendingDocumentKind,
} from './order-document.ts';

test('pendingDocumentKind solo aparece cuando el comprobante está por emitir', () => {
  assert.equal(pendingDocumentKind({
    id: 1,
    documentStatus: 'not_requested',
    requestedDocumentType: 'boleta',
  }), null);
  assert.equal(pendingDocumentKind({
    id: 1,
    documentStatus: 'pending',
    requestedDocumentType: 'factura',
  }), 'factura');
  assert.equal(pendingDocumentKind({
    id: 1,
    documentStatus: 'pending',
    requestedDocumentType: null,
    documentDecision: { type: 'boleta' },
  }), 'boleta');
});

test('generateDocumentPath apunta al alta de boleta o factura', () => {
  assert.equal(generateDocumentPath('boleta'), '/boletas/new');
  assert.equal(generateDocumentPath('factura'), '/facturas/new');
  assert.equal(generateDocumentLabel('boleta'), 'Generar boleta');
  assert.equal(generateDocumentLabel('factura'), 'Generar factura');
});

test('invoicePrefillFromOrder copia cliente, ítems y envío', () => {
  const prefill = invoicePrefillFromOrder({
    id: 44,
    companyId: 3,
    customer: {
      name: 'LIMBO SAC',
      documentType: '6',
      documentNumber: '20990001001',
      legalName: 'LIMBO PERU S.R.L.',
      address: 'Av. La Marina 2055',
    },
    shippingAmount: 18,
    items: [{ description: 'Silla rosa', quantity: 2, unitPrice: 125 }],
  });
  assert.equal(prefill.clientNombre, 'LIMBO PERU S.R.L.');
  assert.equal(prefill.clientNumero, '20990001001');
  assert.equal(prefill.clientDireccion, 'Av. La Marina 2055');
  assert.deepEqual(prefill.items, [
    { descripcion: 'Silla rosa', cantidad: '2', precioUnitario: '125' },
    { descripcion: 'Envío', cantidad: '1', precioUnitario: '18' },
  ]);
});
