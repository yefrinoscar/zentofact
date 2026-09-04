import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INVENTORY_LISTEN_FROM_AT,
  isAfterInventoryListenFrom,
  shouldEnqueueStockJob,
  shouldListenStockOrder,
  stockCommitmentAction,
} from './stock-commitment.js';

test('pending y preparing reservan; listo para enviar confirma', () => {
  assert.equal(stockCommitmentAction('pending'), 'reserve');
  assert.equal(stockCommitmentAction('preparing'), 'reserve');
  assert.equal(stockCommitmentAction('ready_to_ship'), 'commit');
  assert.equal(stockCommitmentAction('shipped'), 'commit');
  assert.equal(stockCommitmentAction('delivered'), 'commit');
  assert.equal(stockCommitmentAction('cancelled'), 'none');
});

test('la cola escucha pending y listo para enviar', () => {
  assert.equal(shouldEnqueueStockJob('pending'), true);
  assert.equal(shouldEnqueueStockJob('preparing'), true);
  assert.equal(shouldEnqueueStockJob('ready_to_ship'), true);
  assert.equal(shouldEnqueueStockJob('cancelled'), false);
});

test('la escucha empieza el 3 set 2026 a las 12:00 Lima', () => {
  assert.equal(INVENTORY_LISTEN_FROM_AT, '2026-09-03T17:00:00.000Z');
  assert.equal(isAfterInventoryListenFrom(null), false);
  assert.equal(isAfterInventoryListenFrom(''), false);
  assert.equal(isAfterInventoryListenFrom('no-es-fecha'), false);
  assert.equal(isAfterInventoryListenFrom('2026-09-03T16:59:59.000Z'), false);
  assert.equal(isAfterInventoryListenFrom('2026-09-03T17:00:00.000Z'), true);
  assert.equal(isAfterInventoryListenFrom('2026-09-03T17:00:01.000Z'), true);
  assert.equal(shouldListenStockOrder({ status: 'pending' }), false);
  assert.equal(shouldListenStockOrder({ status: 'pending', orderedAt: '2026-09-03T16:59:59.000Z' }), false);
  assert.equal(shouldListenStockOrder({ status: 'pending', orderedAt: '2026-09-03T17:00:00.000Z' }), true);
  assert.equal(shouldListenStockOrder({ status: 'cancelled', orderedAt: '2026-09-03T17:00:00.000Z' }), false);
});
