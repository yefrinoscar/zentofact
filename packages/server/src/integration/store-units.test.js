import test from 'node:test';
import assert from 'node:assert/strict';
import { fiscalIdError, isValidRuc, validateBillingInput } from './fiscal-id.js';
import {
  fiscalFingerprint,
  mapStoreOrderToIngest,
  storePaymentMethod,
  validateStoreOrderPayload,
} from './store-order-payload.js';
import { planStoreStep } from './store-fulfillment.js';
import { documentTransitions } from './events.js';
import { buildPolicy, documentRequirementForIssuance, storeSettings } from './settings.js';
import { assertScope, authenticateApiKey } from './auth.js';
import { generateApiKey } from './crypto.js';
import { automaticEmissionInput, classifyEmissionError } from './document-jobs.js';
import { contractFulfillmentStatus, parseDocumentKey } from './store-orders.js';
import { problemBody } from './problems.js';
import { redactRequestPath } from '../request-log.js';
import { isProtectedPath } from '../protected-paths.js';

export function sampleOrder(overrides = {}) {
  return {
    orderNumber: 'L-DHZ2A7',
    orderedAt: '2026-11-28T15:00:00Z',
    updatedAt: '2026-11-28T15:00:05Z',
    currency: 'PEN',
    payment: { status: 'paid', paidAt: '2026-11-28T15:00:00Z', method: 'card', provider: 'mercado_pago', reference: '123' },
    customer: { name: 'Ana Pérez', email: 'ana@example.com', phone: '999999999' },
    document: null,
    fulfillment: {
      type: 'delivery',
      zone: 'provincia',
      address: { recipient: 'Ana Pérez', line1: 'Av. Sol 123', line2: 'Dpto 4', district: 'Wanchaq', department: 'cusco', reference: 'Frente al parque', phone: '988888888' },
    },
    items: [{ id: 'ordli_1', sku: 'ABC-1', description: 'Producto X - Rojo', quantity: 2, unitPrice: 59.9, discount: 10, total: 109.8 }],
    shipping: { description: 'Envío Provincia', total: 15 },
    discountTotal: 10,
    total: 124.8,
    ...overrides,
  };
}

test('valida RUC con dígito verificador y documentos por tipo', () => {
  assert.equal(isValidRuc('20100070970'), true);
  assert.equal(isValidRuc('20100070971'), false);
  assert.equal(isValidRuc('30100070970'), false);
  assert.equal(fiscalIdError('1', '1234567'), 'El DNI debe tener 8 dígitos.');
  assert.equal(fiscalIdError('1', '12345678'), null);
  assert.equal(fiscalIdError('4', 'AB1234567'), null);
  assert.match(fiscalIdError('4', '12345'), /extranjería/);
  assert.equal(fiscalIdError('7', 'X12345'), null);
});

test('datos fiscales del operador: boleta anónima hasta S/ 700 como CLIENTE VARIOS', () => {
  const anonymous = validateBillingInput({ kind: 'boleta', documentType: '0', name: 'Ana' }, { total: 650 });
  assert.deepEqual(anonymous.errors, []);
  assert.equal(anonymous.value.name, 'CLIENTE VARIOS');
  assert.equal(anonymous.value.documentNumber, '');
  const tooHigh = validateBillingInput({ kind: 'boleta', documentType: '0' }, { total: 700.01 });
  assert.match(tooHigh.errors[0].message, /700/);
  const factura = validateBillingInput({ kind: 'factura', documentType: '1', documentNumber: '20100070970', name: 'ACME SAC' }, { total: 10 });
  assert.equal(factura.value.documentType, '6');
  assert.deepEqual(factura.errors.map((error) => error.path), ['address']);
  const ce = validateBillingInput({ kind: 'boleta', documentType: '4', documentNumber: 'ab1234567', name: 'John' }, { total: 900 });
  assert.deepEqual(ce.errors, []);
  assert.equal(ce.value.documentNumber, 'AB1234567');
});

test('PUT: valida montos, líneas en cero y documento', () => {
  assert.deepEqual(validateStoreOrderPayload(sampleOrder(), 'order_01').errors, []);
  const zeroLine = validateStoreOrderPayload(sampleOrder({
    items: [{ id: 'a', sku: 'X', quantity: 1, unitPrice: 0, total: 0 }], shipping: { total: 0 }, total: 0,
  }), 'order_01');
  assert.ok(zeroLine.errors.some((error) => error.path === 'items[0].total'));
  const mismatch = validateStoreOrderPayload(sampleOrder({ total: 130 }), 'order_01');
  assert.equal(mismatch.errors[0].path, 'total');
  assert.deepEqual(validateStoreOrderPayload(sampleOrder({ total: 124.804 }), 'order_01').errors, []);
  const badRuc = validateStoreOrderPayload(sampleOrder({
    document: { type: 'factura', customer: { docType: 'RUC', docNumber: '20100070971', name: 'ACME', address: 'Lima' } },
  }), 'order_01');
  assert.equal(badRuc.errors[0].path, 'document.customer.docNumber');
  const facturaDni = validateStoreOrderPayload(sampleOrder({
    document: { type: 'factura', customer: { docType: 'DNI', docNumber: '12345678', name: 'Ana', address: 'Lima' } },
  }), 'order_01');
  assert.ok(facturaDni.errors.some((error) => /RUC/.test(error.message)));
  assert.equal(validateStoreOrderPayload([], 'x').errors[0].path, '');
});

test('PUT → ingestOrder: envío sin repartidor propio, CE con código 4, pago con tarjeta', () => {
  const { value } = validateStoreOrderPayload(sampleOrder({
    document: { type: 'boleta', customer: { docType: 'CE', docNumber: '001234567', name: 'John Doe', address: 'Av. Lima 1' } },
  }), 'order_01');
  const input = mapStoreOrderToIngest(value, {
    account: { id: 9, companyId: 1, settings: { allowNegative: true } },
    existing: { order_status: 'confirmed', fulfillment_status: 'ready_to_ship' },
    productIdsBySku: new Map([['ABC-1', 77]]),
  });
  assert.equal(input.fulfillmentStatus, 'ready_to_ship');
  assert.equal(input.orderStatus, 'confirmed');
  assert.equal(input.companyId, 1);
  assert.equal(input.source, 'api');
  assert.equal(input.itemsComplete, true);
  assert.equal(input.providerUpdatedAt, '2026-11-28T15:00:05.000Z');
  assert.equal(input.shipping.type, 'envio');
  assert.equal(input.shipping.carrier, undefined);
  assert.equal(input.shipping.address, 'Av. Sol 123, Dpto 4');
  assert.equal(input.shipping.region, 'cusco');
  assert.equal(input.requestedDocumentType, 'boleta');
  assert.deepEqual(input.customer, {
    name: 'Ana Pérez', email: 'ana@example.com', phone: '999999999',
    documentType: '4', documentNumber: '001234567', legalName: 'John Doe', address: 'Av. Lima 1',
  });
  assert.equal(input.metadata.paymentMethod, 'tarjeta');
  assert.equal(input.paymentStatus, 'paid');
  assert.equal(input.items[0].productId, 77);
  assert.equal(input.subtotal, 109.8);
  assert.equal(input.shippingAmount, 15);
});

test('PUT sin documento: contacto con nulls explícitos y sin tocar los datos fiscales del operador', () => {
  const { value } = validateStoreOrderPayload(sampleOrder({
    customer: { name: 'Ana' },
    fulfillment: { type: 'pickup', zone: null, address: {} },
    shipping: { total: 0 },
    total: 109.8,
  }), 'order_01');
  const input = mapStoreOrderToIngest(value, { account: { id: 9, companyId: 1, settings: {} }, existing: null });
  assert.deepEqual(input.customer, { name: 'Ana', email: null, phone: null });
  assert.equal(input.requestedDocumentType, undefined);
  assert.equal(input.shipping.type, 'recojo');
  assert.equal(input.shipping.address, null);
  assert.equal(input.fulfillmentStatus, 'pending');
  assert.equal(input.orderStatus, 'new');
});

test('la huella fiscal cambia con ítems, montos o documento pero no con el contacto', () => {
  const base = validateStoreOrderPayload(sampleOrder(), 'o').value;
  const contact = validateStoreOrderPayload(sampleOrder({ customer: { name: 'Otra', phone: '1' } }), 'o').value;
  const items = validateStoreOrderPayload(sampleOrder({
    items: [{ id: 'ordli_1', sku: 'ABC-1', quantity: 1, unitPrice: 109.8, total: 109.8 }],
  }), 'o').value;
  assert.equal(fiscalFingerprint(base), fiscalFingerprint(contact));
  assert.notEqual(fiscalFingerprint(base), fiscalFingerprint(items));
  assert.equal(storePaymentMethod('card'), 'tarjeta');
  assert.equal(storePaymentMethod('yape'), 'yape_plin');
});

test('Bandeja: pasos de tienda con envío y recojo', () => {
  const now = new Date('2026-11-28T16:00:00Z');
  const delivery = { order_status: 'new', fulfillment_status: 'pending', shipping: { type: 'envio' }, metadata: {} };
  const confirm = planStoreStep(delivery, { step: 'confirm' }, now);
  assert.equal(confirm.target, 'preparing');
  assert.equal(confirm.orderStatus, 'confirmed');
  assert.equal(confirm.storeFulfillment.confirmedAt, now.toISOString());
  assert.throws(() => planStoreStep(delivery, { step: 'deliver' }, now), /enviado/);
  assert.throws(() => planStoreStep({ ...delivery, fulfillment_status: 'ready_to_ship' }, { step: 'ship' }, now), /transportista/);
  const ship = planStoreStep({ ...delivery, fulfillment_status: 'ready_to_ship', metadata: { storeFulfillment: { confirmedAt: 'a', readyAt: 'b' } } }, {
    step: 'ship', carrier: 'shaloom', trackingNumber: ' 123 ', trackingUrl: 'https://shalom.pe/t/123',
  }, now);
  assert.deepEqual(ship.storeFulfillment, {
    confirmedAt: 'a', readyAt: 'b', shippedAt: now.toISOString(), carrier: 'shaloom', trackingNumber: '123', trackingUrl: 'https://shalom.pe/t/123',
  });
  assert.throws(() => planStoreStep(delivery, { step: 'ship', carrier: 'shaloom', trackingUrl: 'javascript:x' }, now), /URL/);
  assert.equal(planStoreStep({ ...delivery, fulfillment_status: 'shipped' }, { step: 'ready' }, now).alreadyDone, true);

  const pickup = { order_status: 'new', fulfillment_status: 'pending', shipping: { type: 'recojo' }, metadata: {} };
  assert.throws(() => planStoreStep(pickup, { step: 'ship', carrier: 'shaloom' }, now), /recojo/);
  const picked = planStoreStep(pickup, { step: 'deliver' }, now);
  assert.equal(picked.target, 'delivered');
  assert.equal(picked.orderStatus, 'completed');
  assert.equal(picked.storeFulfillment.shippedAt, undefined);
  assert.equal(picked.storeFulfillment.readyAt, now.toISOString());
  assert.throws(() => planStoreStep({ ...pickup, order_status: 'cancelled' }, { step: 'confirm' }, now), /cancelado/);
});

test('mapea el avance de despacho al contrato', () => {
  assert.equal(contractFulfillmentStatus({ order_status: 'new', fulfillment_status: 'pending' }), 'pending');
  assert.equal(contractFulfillmentStatus({ order_status: 'confirmed', fulfillment_status: 'preparing' }), 'confirmed');
  assert.equal(contractFulfillmentStatus({ order_status: 'confirmed', fulfillment_status: 'ready_to_ship' }), 'ready');
  assert.equal(contractFulfillmentStatus({ order_status: 'cancelled', fulfillment_status: 'pending' }), 'cancelled');
  assert.deepEqual(parseDocumentKey('boleta:456'), { kind: 'boleta', id: 456 });
  assert.equal(parseDocumentKey('boleta:abc'), null);
  assert.equal(parseDocumentKey('../x'), null);
});

test('eventos de comprobante: emitido, aceptado, rechazado y anulado por nota de crédito', () => {
  const issued = documentTransitions([{ id: 'boleta:1', kind: 'boleta', number: 'B001-1', status: 'issued' }], new Map());
  assert.deepEqual(issued.events.map((event) => event.type), ['document.issued']);
  const accepted = documentTransitions([{ id: 'boleta:1', kind: 'boleta', number: 'B001-1', status: 'accepted' }], new Map([['boleta:1', 'issued']]));
  assert.deepEqual(accepted.events.map((event) => event.type), ['document.accepted']);
  const firstSeenAccepted = documentTransitions([{ id: 'factura:2', kind: 'factura', number: 'F001-2', status: 'accepted' }], new Map());
  assert.deepEqual(firstSeenAccepted.events.map((event) => event.type), ['document.issued', 'document.accepted']);
  const rejected = documentTransitions([{ id: 'boleta:1', kind: 'boleta', number: 'B001-1', status: 'rejected', reason: '2800' }], new Map([['boleta:1', 'issued']]));
  assert.deepEqual(rejected.events[0], { type: 'document.rejected', data: { documentId: 'boleta:1', kind: 'boleta', number: 'B001-1', reason: '2800' } });
  const voided = documentTransitions([
    { id: 'boleta:1', kind: 'boleta', number: 'B001-1', status: 'voided' },
    { id: 'credit_note:9', kind: 'credit_note', number: 'BC01-9', status: 'accepted', affects: 'boleta:1' },
  ], new Map([['boleta:1', 'accepted'], ['credit_note:9', 'issued']]));
  assert.deepEqual(voided.events, [{ type: 'document.voided', data: { documentId: 'boleta:1', creditNoteId: 'credit_note:9', number: 'BC01-9' } }]);
  const unchanged = documentTransitions([{ id: 'boleta:1', kind: 'boleta', number: 'B001-1', status: 'accepted' }], new Map([['boleta:1', 'accepted']]));
  assert.deepEqual(unchanged.events, []);
  assert.deepEqual(unchanged.states, []);
});

test('política: modo de emisión configurable y mapeo a document_requirement', () => {
  assert.equal(documentRequirementForIssuance('on_request'), 'optional');
  assert.equal(documentRequirementForIssuance('always'), 'required');
  const account = { settings: { integration: true, issuanceMode: 'on_request', creditNoteOnCancel: 'auto' }, updatedAt: '2026-11-28T15:00:00.000Z' };
  const policy = buildPolicy(account);
  assert.equal(policy.issuance.mode, 'on_request');
  assert.deepEqual(policy.series, { boleta: 'B001', factura: 'F001' });
  assert.equal(policy.anonymousMaxAmount, 700);
  assert.match(policy.version, /^2026-11-28T15:00:00Z#[0-9a-f]{8}$/);
  assert.notEqual(buildPolicy({ ...account, settings: { ...account.settings, issuanceMode: 'always' } }).version, policy.version);
  assert.equal(storeSettings({ documentRequirement: 'required', settings: {} }).issuanceMode, 'always');
  assert.equal(storeSettings({ settings: {} }).allowNegative, true);
});

test('emisión automática: boleta anónima hasta S/ 700 y clasificación de errores', () => {
  const defaults = { kind: 'boleta', serie: 'B001', client: { documentType: '0', documentNumber: '', name: 'Ana' } };
  assert.equal(automaticEmissionInput({ total: 120, customer: { name: 'Ana' } }, defaults).client.name, 'CLIENTE VARIOS');
  assert.throws(() => automaticEmissionInput({ total: 800, customer: {} }, defaults), (error) => error.needsCustomerData === true);
  const withDni = { ...defaults, client: { documentType: '1', documentNumber: '12345678', name: 'Ana' } };
  assert.equal(automaticEmissionInput({ total: 800, customer: { documentNumber: '12345678' } }, withDni), withDni);
  assert.equal(classifyEmissionError(new Error('El pedido ya tiene un comprobante. Consulta SUNAT o reemítelo.')), 'reconcile');
  assert.equal(classifyEmissionError(new Error('La factura requiere un RUC de 11 dígitos.')), 'permanent');
  assert.equal(classifyEmissionError(new Error('ECONNRESET')), 'transient');
});

test('problemas RFC 9457 con type, code y retryable', () => {
  assert.deepEqual(problemBody('stale_update', 'x'), {
    type: 'https://zentofact.app/problems/stale_update', title: 'Ya existe una versión más reciente',
    status: 409, detail: 'x', code: 'stale_update', retryable: false,
  });
  assert.equal(problemBody('idempotency_in_progress').retryable, true);
  assert.equal(problemBody('nope').code, 'internal');
});

test('el log [REQ] no expone el token del webhook de Falabella y /api/v1 no exige sesión', () => {
  assert.equal(redactRequestPath('/webhooks/falabella/1/s3cr3t'), '/webhooks/falabella/1/[redactado]');
  assert.equal(redactRequestPath('/webhooks/falabella/1'), '/webhooks/falabella/1');
  assert.equal(redactRequestPath('/order-management/orders/5'), '/order-management/orders/5');
  assert.equal(isProtectedPath('/api/v1/orders/order_1'), false);
});

function keyDb(row) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      if (sql.includes('from integration_keys k')) return { rows: row && params[0] === row.key_id ? [row] : [] };
      return { rows: [] };
    },
  };
}

function keyRow(key, overrides = {}) {
  return {
    key_row_id: 1, key_id: key.keyId, env: key.env, secret_hash: key.secretHash,
    scopes: ['orders:read'], revoked_at: null,
    id: 9, company_id: 1, channel_code: 'external', display_name: 'Tienda',
    document_requirement: 'optional', document_type_policy: 'automatic',
    settings: { integration: true }, active: true, updated_at: new Date(),
    ...overrides,
  };
}

test('auth: llave válida, entorno distinto, revocada, secreto incorrecto y cuenta sin integración', async () => {
  const key = generateApiKey('test');
  const env = { NODE_ENV: 'development' };
  const ok = await authenticateApiKey(keyDb(keyRow(key)), `Bearer ${key.token}`, { env });
  assert.equal(ok.account.id, 9);
  assert.deepEqual(ok.scopes, ['orders:read']);
  await assert.rejects(authenticateApiKey(keyDb(keyRow(key)), `Bearer ${key.token}`, { env: { NODE_ENV: 'production' } }),
    (error) => error.code === 'unauthorized' && /live/.test(error.message));
  await assert.rejects(authenticateApiKey(keyDb(keyRow(key, { revoked_at: new Date() })), `Bearer ${key.token}`, { env }),
    (error) => error.code === 'unauthorized');
  const wrong = `${key.token.slice(0, -1)}${key.token.endsWith('0') ? '1' : '0'}`;
  await assert.rejects(authenticateApiKey(keyDb(keyRow(key)), `Bearer ${wrong}`, { env }), (error) => error.code === 'unauthorized');
  await assert.rejects(authenticateApiKey(keyDb(keyRow(key, { settings: {} })), `Bearer ${key.token}`, { env }),
    (error) => error.code === 'unauthorized');
  await assert.rejects(authenticateApiKey(keyDb(null), `Bearer ${key.token}`, { env }), (error) => error.code === 'unauthorized');
  await assert.rejects(authenticateApiKey(keyDb(null), 'Basic abc', { env }), (error) => error.code === 'unauthorized');
  const live = generateApiKey('live');
  await assert.rejects(authenticateApiKey(keyDb(keyRow(live)), `Bearer ${live.token}`, { env }),
    (error) => /test/.test(error.message));
  assert.throws(() => assertScope(['orders:read'], 'orders:write'), (error) => error.code === 'forbidden_scope');
});
