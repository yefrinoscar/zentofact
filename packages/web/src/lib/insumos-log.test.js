import test from 'node:test';
import assert from 'node:assert/strict';
import {
  capErrorMessage,
  formatInsumoActor,
  formatInsumoChange,
  formatInsumoWhen,
  nextQuantity,
} from './insumos-log.ts';

test('describe el cambio y el saldo que queda', () => {
  assert.equal(formatInsumoChange(2, 6), '+2 · queda 6');
  assert.equal(formatInsumoChange(-1, 3), '-1 · queda 3');
});

test('muestra quién y cuándo en hora de Lima', () => {
  assert.equal(formatInsumoActor('Ana Rojas'), 'Ana Rojas');
  assert.equal(formatInsumoActor('  '), 'Sin nombre');
  const when = formatInsumoWhen('2026-08-19T17:05:00.000Z');
  assert.match(when, /19/);
  assert.match(when, /ago/i);
  assert.match(when, /12:05/);
});

test('avisa el tope antes de pedir el PIN', () => {
  assert.equal(nextQuantity(15, { delta: 1 }), 16);
  assert.equal(nextQuantity(4, { absoluteTarget: 12 }), 12);
  assert.equal(capErrorMessage('Fill grande', 16), 'Fill grande no puede pasar de 16.');
});
