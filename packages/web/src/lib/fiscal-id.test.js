import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANONYMOUS_CUSTOMER_NAME,
  fiscalFormFromOrder,
  isValidCe,
  isValidDni,
  isValidPassport,
  isValidRuc,
  normalizeFiscalNumber,
  validateFiscalForm,
} from './fiscal-id.ts';

test('DNI exige exactamente 8 dígitos', () => {
  assert.equal(isValidDni('12345678'), true);
  assert.equal(isValidDni('1234567'), false);
  assert.equal(isValidDni('123456789'), false);
  assert.equal(isValidDni('1234567a'), false);
});

test('CE acepta 9 a 12 letras o números y pasaporte 6 a 12', () => {
  assert.equal(isValidCe('001234567'), true);
  assert.equal(isValidCe('AB1234567890'), true);
  assert.equal(isValidCe('12345678'), false);
  assert.equal(isValidCe('AB12345678901'), false);
  assert.equal(isValidPassport('X12345'), true);
  assert.equal(isValidPassport('X1234'), false);
});

test('RUC valida prefijo y dígito verificador SUNAT', () => {
  assert.equal(isValidRuc('20100070970'), true);
  assert.equal(isValidRuc('20131312955'), true);
  assert.equal(isValidRuc('10467793549'), true);
  assert.equal(isValidRuc('20100070971'), false, 'dígito verificador incorrecto');
  assert.equal(isValidRuc('30100070970'), false, 'prefijo inválido');
  assert.equal(isValidRuc('2010007097'), false, 'longitud');
});

test('normaliza el número según el tipo', () => {
  assert.equal(normalizeFiscalNumber('1', ' 12.345.678 '), '12345678');
  assert.equal(normalizeFiscalNumber('4', 'ab-123 4567'), 'AB1234567');
  assert.equal(normalizeFiscalNumber('0', '999'), '');
});

test('factura fuerza RUC y exige razón social y dirección', () => {
  const result = validateFiscalForm({ kind: 'factura', documentType: '1', documentNumber: '20100070970', name: '', address: '' }, 100);
  assert.equal(result.valid, false);
  assert.equal(result.value.documentType, '6');
  assert.ok(result.errors.name);
  assert.ok(result.errors.address);
  const ok = validateFiscalForm({ kind: 'factura', documentType: '6', documentNumber: '20100070970', name: 'Empresa SAC', address: 'Av. Lima 123' }, 100);
  assert.equal(ok.valid, true);
});

test('boleta anónima solo hasta S/ 700 y a nombre de CLIENTE VARIOS', () => {
  const ok = validateFiscalForm({ kind: 'boleta', documentType: '0', documentNumber: '123', name: 'Ana', address: '' }, 700);
  assert.equal(ok.valid, true);
  assert.equal(ok.value.name, ANONYMOUS_CUSTOMER_NAME);
  assert.equal(ok.value.documentNumber, '');
  const tooHigh = validateFiscalForm({ kind: 'boleta', documentType: '0', documentNumber: '', name: '', address: '' }, 700.01);
  assert.equal(tooHigh.valid, false);
  assert.match(tooHigh.errors.documentType, /700/);
});

test('boleta con DNI valida el número y pide nombre', () => {
  const bad = validateFiscalForm({ kind: 'boleta', documentType: '1', documentNumber: '1234', name: '', address: '' }, 50);
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.documentNumber);
  assert.ok(bad.errors.name);
  const ok = validateFiscalForm({ kind: 'boleta', documentType: '1', documentNumber: '12345678', name: 'Ana  Pérez', address: '' }, 50);
  assert.equal(ok.valid, true);
  assert.equal(ok.value.name, 'Ana Pérez');
});

test('el formulario parte de los datos del pedido', () => {
  assert.deepEqual(fiscalFormFromOrder({ customer: { name: 'Ana', documentType: '4', documentNumber: '001234567' } }), {
    kind: 'boleta', documentType: '4', documentNumber: '001234567', name: 'Ana', address: '',
  });
  const factura = fiscalFormFromOrder({ requestedDocumentType: 'factura', customer: { name: 'Ana', legalName: 'Ana SAC', documentNumber: '20100070970', address: 'Av. 1' } });
  assert.equal(factura.kind, 'factura');
  assert.equal(factura.documentType, '6');
  assert.equal(factura.name, 'Ana SAC');
  assert.equal(fiscalFormFromOrder({}).documentType, '1');
});
