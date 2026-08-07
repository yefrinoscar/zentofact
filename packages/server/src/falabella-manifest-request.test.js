import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeFalabellaManifestDocumentRequests,
  normalizeFalabellaManifestOrders,
} from './falabella-manifest-request.js';

test('normaliza y deduplica pedidos por compañía e identidad', () => {
  const result = normalizeFalabellaManifestOrders([
    { companyId: '5', orderId: ' 10 ', orderNumber: ' A ' },
    { companyId: 5, orderId: '10', orderNumber: 'A', ignored: 'value' },
    { companyId: 5, orderNumber: 'A' },
    { companyId: 6, orderId: 10 },
    { companyId: 5, orderId: '11' },
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.orders, [
    { companyId: 5, orderId: '10', orderNumber: 'A' },
    { companyId: 6, orderId: '10' },
    { companyId: 5, orderId: '11' },
  ]);
});

test('rechaza toda la selección si cualquier pedido está malformado', () => {
  for (const value of [
    [],
    [{ companyId: 0, orderId: '10' }],
    [{ companyId: true, orderId: '10' }],
    [{ companyId: 5 }],
    [{ companyId: 5, orderId: {} }],
    [{ companyId: 5, orderId: '10' }, null],
  ]) {
    const result = normalizeFalabellaManifestOrders(value);
    assert.equal(result.ok, false);
    assert.deepEqual(result.orders, []);
  }
});

test('aplica el límite antes de deduplicar', () => {
  const result = normalizeFalabellaManifestOrders([
    { companyId: 5, orderId: '10' },
    { companyId: 5, orderId: '10' },
  ], 1);
  assert.equal(result.ok, false);
  assert.match(result.error, /hasta 1 pedido/);
});

test('la consulta reutiliza la misma validación y deduplicación', () => {
  const input = [
    { companyId: 5, orderId: '10', orderNumber: 'A' },
    { companyId: 5, orderNumber: 'A' },
  ];
  const createSelection = normalizeFalabellaManifestOrders(input);
  const listSelection = normalizeFalabellaManifestOrders(input, 500, 'consultar');
  assert.deepEqual(listSelection.orders, createSelection.orders);
  assert.equal(listSelection.ok, true);

  const invalid = normalizeFalabellaManifestOrders([], 500, 'consultar');
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /pedidos listos para consultar/);
});

test('normaliza el lote imprimible con dedupe compuesto y aislamiento por tienda', () => {
  const first = '83b0e7d4-ff6f-4acf-9b20-b5e74a48f971';
  const second = 'f6482173-8435-4c1b-ba6c-b856ef10ea34';
  const result = normalizeFalabellaManifestDocumentRequests([
    { companyId: '5', manifestId: ` ${first} ` },
    { companyId: 5, manifestId: first },
    { companyId: 6, manifestId: first },
    { companyId: 5, manifestId: second },
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.manifests, [
    { companyId: 5, manifestId: first },
    { companyId: 6, manifestId: first },
    { companyId: 5, manifestId: second },
  ]);
});

test('rechaza lotes imprimibles vacíos, malformados o sobre el límite', () => {
  assert.equal(normalizeFalabellaManifestDocumentRequests([]).ok, false);
  assert.equal(normalizeFalabellaManifestDocumentRequests([
    { companyId: 0, manifestId: '83b0e7d4-ff6f-4acf-9b20-b5e74a48f971' },
  ]).ok, false);
  assert.equal(normalizeFalabellaManifestDocumentRequests([
    { companyId: 5, manifestId: '' },
  ]).ok, false);
  assert.equal(normalizeFalabellaManifestDocumentRequests([
    { companyId: 5, manifestId: 'MFJB/SC8F004/20260807095641096' },
  ]).ok, false);
  const limited = normalizeFalabellaManifestDocumentRequests([
    { companyId: 5, manifestId: '83b0e7d4-ff6f-4acf-9b20-b5e74a48f971' },
    { companyId: 5, manifestId: '83b0e7d4-ff6f-4acf-9b20-b5e74a48f971' },
  ], 1);
  assert.equal(limited.ok, false);
  assert.match(limited.error, /hasta 1 manifiestos/);
});
