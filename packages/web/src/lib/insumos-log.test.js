import test from 'node:test';
import assert from 'node:assert/strict';
import {
  capErrorMessage,
  formatInsumoActor,
  formatInsumoChange,
  formatInsumoPurchaseCopy,
  formatInsumoPurchaseValue,
  formatInsumoWhen,
  nextQuantity,
  suggestInsumoPurchases,
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

test('calcula cuánto pedir para días, semana y mes', () => {
  const covered = suggestInsumoPurchases({ consumedRecent: 7, quantityOnHand: 8 });
  assert.equal(covered.hasConsumption, true);
  assert.equal(covered.days, 0);
  assert.equal(covered.week, 0);
  assert.equal(covered.month, 22);
  assert.equal(formatInsumoPurchaseValue(covered.month), '22');
  assert.equal(formatInsumoPurchaseValue(0, false), '—');
});

test('dice cuánto comprar para cubrir la semana y el mes', () => {
  const empty = formatInsumoPurchaseCopy();
  assert.equal(empty.empty, 'Todavía no hay consumo.');
  assert.equal(empty.week, null);
  const monthOnly = formatInsumoPurchaseCopy(suggestInsumoPurchases({
    consumedRecent: 7,
    quantityOnHand: 8,
  }), 'rollos');
  assert.equal(monthOnly.week?.value, 'Nada');
  assert.equal(monthOnly.week?.label, 'para cubrir la semana');
  assert.equal(monthOnly.month?.value, '22 rollos');
  assert.equal(monthOnly.month?.label, 'para cubrir el mes');
  const both = formatInsumoPurchaseCopy(suggestInsumoPurchases({
    consumedRecent: 14,
    quantityOnHand: 4,
  }), 'rollos');
  assert.equal(both.week?.value, '10 rollos');
  assert.equal(both.month?.value, '56 rollos');
});
