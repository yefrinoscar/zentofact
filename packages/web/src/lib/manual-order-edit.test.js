import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildManualOrderEditPayload,
  validateManualOrderEdit,
} from './manual-order-edit.ts';

const baseDraft = {
  customerName: ' Luisa Pérez ',
  customerPhone: '999 111 222',
  documentType: '1',
  documentNumber: '12345678',
  legalName: '',
  deliveryType: 'recojo',
  carrier: '',
  address: '',
  reference: '',
  deliveryDate: '2026-10-01',
  lines: [{ id: 5, name: 'Mesa', quantity: '2', unitPrice: '99.9' }],
};

test('una venta editable no tiene errores', () => {
  assert.equal(validateManualOrderEdit(baseDraft), null);
});

test('la edición exige fecha, repartidor en envío, producto y cantidades válidas', () => {
  assert.equal(
    validateManualOrderEdit({ ...baseDraft, deliveryDate: '' }),
    'Indica la fecha de entrega.',
  );
  assert.equal(
    validateManualOrderEdit({ ...baseDraft, deliveryType: 'envio', carrier: '' }),
    'Elige el repartidor del envío.',
  );
  assert.equal(
    validateManualOrderEdit({ ...baseDraft, lines: [] }),
    'La venta necesita al menos un producto.',
  );
  assert.equal(
    validateManualOrderEdit({ ...baseDraft, lines: [{ id: 5, name: 'Mesa', quantity: '0', unitPrice: '10' }] }),
    'La cantidad debe ser al menos 1.',
  );
  assert.equal(
    validateManualOrderEdit({ ...baseDraft, lines: [{ id: 5, name: 'Mesa', quantity: '1', unitPrice: '-1' }] }),
    'El precio no puede ser negativo.',
  );
});

test('el RUC y el DNI deben tener sus dígitos', () => {
  assert.equal(
    validateManualOrderEdit({ ...baseDraft, documentType: '6', documentNumber: '20123' }),
    'El RUC debe tener 11 dígitos.',
  );
  assert.equal(
    validateManualOrderEdit({ ...baseDraft, documentType: '1', documentNumber: '123' }),
    'El DNI debe tener 8 dígitos.',
  );
});

test('el payload recorta textos y no arrastra repartidor en recojo', () => {
  const payload = buildManualOrderEditPayload(baseDraft);
  assert.deepEqual(payload.shipping, { type: 'recojo', carrier: '', address: '', reference: '' });
  assert.equal(payload.customer.name, 'Luisa Pérez');
  assert.equal(payload.customer.documentNumber, '12345678');
  assert.deepEqual(payload.items, [{ id: 5, quantity: 2, unitPrice: 99.9 }]);
  assert.equal(payload.deliveryDate, '2026-10-01');
});

test('el envío conserva el repartidor y la razón social solo en RUC', () => {
  const payload = buildManualOrderEditPayload({
    ...baseDraft,
    deliveryType: 'envio',
    carrier: 'shaloom',
    address: 'Av. Siempre Viva 742',
    reference: 'Portón azul',
    documentType: '6',
    documentNumber: '20123456789',
    legalName: 'Mesa SAC',
  });
  assert.equal(payload.shipping.carrier, 'shaloom');
  assert.equal(payload.customer.documentType, '6');
  assert.equal(payload.customer.legalName, 'Mesa SAC');
});
