import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attentionDeadlineKey,
  attentionDeadlineTabs,
  filterAttentionDeadline,
  formatAttentionIngress,
} from './order-attention-presentation.ts';

const NOW = new Date('2026-08-24T15:00:00Z');

test('clasifica el plazo de entrega en Lima y conserva vencidos y sin plazo', () => {
  assert.equal(attentionDeadlineKey({ promisedShippingAt: '2026-08-23T21:00:00Z' }, NOW), 'overdue');
  assert.equal(attentionDeadlineKey({ promisedShippingAt: '2026-08-24T21:00:00Z' }, NOW), 'today');
  assert.equal(attentionDeadlineKey({ promisedShippingAt: '2026-08-25T21:00:00Z' }, NOW), 'tomorrow');
  assert.equal(attentionDeadlineKey({ promisedShippingAt: null }, NOW), 'no-date');
});

test('construye un filtro compartido para las dos columnas', () => {
  const items = [
    { id: 1, promisedShippingAt: '2026-08-23T21:00:00Z' },
    { id: 2, promisedShippingAt: '2026-08-24T21:00:00Z' },
    { id: 3, promisedShippingAt: '2026-08-25T21:00:00Z' },
    { id: 4, promisedShippingAt: '2026-08-27T21:00:00Z' },
    { id: 5, promisedShippingAt: null },
  ];
  assert.deepEqual(attentionDeadlineTabs(items, NOW).map((tab) => [tab.value, tab.count]), [
    ['all', 5],
    ['overdue', 1],
    ['today', 1],
    ['tomorrow', 1],
    ['2026-08-27', 1],
    ['no-date', 1],
  ]);
  assert.deepEqual(filterAttentionDeadline(items, 'today', NOW).map((item) => item.id), [2]);
});

test('muestra ingreso relativo y fecha exacta como la bandeja operativa', () => {
  const result = formatAttentionIngress('2026-08-23T15:00:00Z', NOW);
  assert.equal(result.relative, 'hace 1 día');
  assert.match(result.exact, /23 ago/);
});
