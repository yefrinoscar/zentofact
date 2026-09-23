import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addDaysToDateKey,
  dateFromKey,
  dateKey,
  documentDateRangeFirstMonth,
  documentDateRangeForLastDays,
  documentDateRangeLabel,
} from './documentDateRange.ts';

test('el primer mes del calendario de rango no deja un panel en el futuro', () => {
  // Rango dentro del mes actual con dos paneles: muestra el mes anterior y el actual.
  assert.equal(documentDateRangeFirstMonth('2026-09-01', '2026-09-23', 2), '2026-08-01');
  // El inicio ya cae en el mes anterior: los dos paneles cubren el rango.
  assert.equal(documentDateRangeFirstMonth('2026-08-25', '2026-09-23', 2), '2026-08-01');
  // Rango largo: arranca en el mes del inicio.
  assert.equal(documentDateRangeFirstMonth('2026-07-15', '2026-09-23', 2), '2026-07-01');
  // Un solo panel: arranca en el mes del inicio.
  assert.equal(documentDateRangeFirstMonth('2026-09-01', '2026-09-23', 1), '2026-09-01');
});

test('las claves de fecha no se corren al sumar días', () => {
  assert.equal(addDaysToDateKey('2026-08-31', 1), '2026-09-01');
  assert.equal(addDaysToDateKey('2026-03-01', -1), '2026-02-28');
  assert.equal(dateKey(dateFromKey('2026-09-23')), '2026-09-23');
});

test('el rango de últimos días incluye hoy', () => {
  const range = documentDateRangeForLastDays(30);
  assert.match(range.to, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(range.from < range.to);
});

test('la etiqueta del rango se lee corta dentro del mismo mes', () => {
  assert.equal(documentDateRangeLabel({ from: '2026-08-04', to: '2026-08-23' }), '4 - 23 ago. 2026');
});
