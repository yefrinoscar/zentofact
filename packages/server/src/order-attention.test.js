import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOrderAttention, groupAttentionProducts } from './order-attention.js';

function row(overrides = {}) {
  return {
    id: 10,
    company_id: 7,
    company_commercial_name: 'TIENDAS STINGRAY S.A.C.',
    company_name: 'Tiendas Stingray',
    company_legal_name: 'Tiendas Stingray SAC',
    channel_code: 'falabella',
    channel_name: 'Falabella',
    external_order_id: 'ORDER-10',
    external_order_number: '3249419945',
    fulfillment_status: 'pending',
    provider_status: 'pending',
    items_status: 'complete',
    items_error: null,
    metadata: {},
    customer: { name: 'Cliente' },
    ordered_at: '2026-08-24T15:00:00Z',
    promised_shipping_at: '2026-08-25T21:00:00Z',
    currency: 'PEN',
    total: 120,
    items: [],
    label_prints: [],
    ...overrides,
  };
}

test('consolida unidades repetidas del mismo producto en una imagen con cantidad', () => {
  assert.deepEqual(groupAttentionProducts([
    { id: 1, sku: 'SKU-1', description: 'Bastón', quantity: 2, imageUrl: 'one.jpg' },
    { id: 2, sku: 'SKU-1', description: 'Bastón', quantity: 3, imageUrl: 'two.jpg' },
  ]), [{ id: 1, sku: 'SKU-1', name: 'Bastón', quantity: 5, imageUrl: 'one.jpg' }]);
});

test('pendientes son pedidos y listos son etiquetas con impresión independiente', () => {
  const result = buildOrderAttention([
    row(),
    row({
      id: 11,
      external_order_id: 'ORDER-11',
      external_order_number: '3249419946',
      fulfillment_status: 'ready_to_ship',
      provider_status: 'ready_to_ship',
      metadata: { labelCount: 3 },
      items: [1, 2, 3].map((packageNumber) => ({
        id: packageNumber,
        sku: 'BASTON',
        description: 'Bastón',
        quantity: packageNumber,
        imageUrl: 'baston.jpg',
        rawData: { PackageId: `PKG-${packageNumber}` },
      })),
      label_prints: [{ labelIndex: 2, printCount: 1, lastPrintedAt: '2026-08-24T18:00:00Z' }],
    }),
  ]);

  assert.equal(result.pending.length, 1);
  assert.equal(result.pending[0].companyName, 'Stingray');
  assert.equal(result.ready.length, 3);
  assert.deepEqual(result.ready.map((ticket) => ({
    label: ticket.labelIndex,
    quantity: ticket.products[0].quantity,
    printed: ticket.printed,
  })), [
    { label: 1, quantity: 1, printed: false },
    { label: 3, quantity: 3, printed: false },
    { label: 2, quantity: 2, printed: true },
  ]);
  assert.deepEqual(result.counts, {
    pendingOrders: 1,
    readyLabels: 3,
    readyOrders: 1,
    problems: 0,
  });
});

test('excluye de la bandeja los bloqueos persistentes y los cuenta como problemas', () => {
  const result = buildOrderAttention([
    row({ items_status: 'error', items_error: 'Líneas incompletas' }),
    row({
      id: 12,
      external_order_id: 'ORDER-12',
      fulfillment_status: 'ready_to_ship',
      metadata: { labelCount: 2 },
      items: [{ id: 1, sku: 'SKU', quantity: 1 }],
    }),
  ], 1);
  assert.equal(result.pending.length, 0);
  assert.equal(result.ready.length, 0);
  assert.equal(result.counts.problems, 2);
});
