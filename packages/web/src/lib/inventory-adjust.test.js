import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inventoryAdjustFormFromOnHand,
  inventoryAdjustPayload,
} from './inventory-adjust.ts';

test('la ficha abre el ajuste con el saldo de almacén', () => {
  assert.deepEqual(inventoryAdjustFormFromOnHand(12), {
    mode: 'absolute',
    value: '12',
    reason: '',
  });
  assert.equal(inventoryAdjustFormFromOnHand(undefined).value, '');
});

test('fijar saldo envía el objetivo absoluto', () => {
  assert.deepEqual(
    inventoryAdjustPayload({ mode: 'absolute', value: '20', reason: ' conteo ' }),
    { absoluteTarget: 20, reason: 'conteo' },
  );
});

test('sumar o restar admite un delta negativo', () => {
  assert.deepEqual(
    inventoryAdjustPayload({ mode: 'delta', value: '-3', reason: 'merma' }),
    { delta: -3, reason: 'merma' },
  );
});

test('rechaza un saldo negativo o un delta vacío', () => {
  assert.throws(
    () => inventoryAdjustPayload({ mode: 'absolute', value: '-1', reason: 'conteo' }),
    /no puede ser negativo/,
  );
  assert.throws(
    () => inventoryAdjustPayload({ mode: 'delta', value: '0', reason: 'conteo' }),
    /no puede ser cero/,
  );
  assert.throws(
    () => inventoryAdjustPayload({ mode: 'absolute', value: 'abc', reason: 'conteo' }),
    /número válido/,
  );
});
