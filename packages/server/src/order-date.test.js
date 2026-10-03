import test from 'node:test';
import assert from 'node:assert/strict';
import { manualOrderTimestamp, orderDateTimestamp, requireOrderDateConfirmations } from './order-date.js';

test('solo administradores pueden elegir la fecha de registro, con dos confirmaciones', () => {
  const input = { orderDate: '2026-09-15', dateConfirmed: true, dateFinalConfirmed: true };
  for (const role of ['admin', 'superadmin']) {
    assert.equal(manualOrderTimestamp(input, role), '2026-09-15T17:00:00.000Z');
  }
  for (const role of ['vendedor', 'operator', 'billing', undefined]) {
    assert.throws(() => manualOrderTimestamp(input, role), { status: 403 });
    assert.throws(() => manualOrderTimestamp({ orderedAt: '2026-09-15T17:00:00Z' }, role), { status: 403 });
    assert.ok(Math.abs(Date.now() - new Date(manualOrderTimestamp({}, role)).getTime()) < 1000);
  }
});

test('no permite omitir ninguna confirmación', () => {
  for (const input of [{}, { dateConfirmed: true }, { dateFinalConfirmed: true }, { dateConfirmed: 'true', dateFinalConfirmed: true }]) {
    assert.throws(() => requireOrderDateConfirmations(input), /dos veces/);
    assert.throws(() => manualOrderTimestamp({ ...input, orderDate: '2026-09-15' }, 'admin'), /dos veces/);
  }
});

test('valida fechas reales y mantiene el día en Lima', () => {
  assert.equal(orderDateTimestamp('2024-02-29'), '2024-02-29T17:00:00.000Z');
  for (const date of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-1-1', '', null, '2026-09-15T00:00:00Z']) {
    assert.throws(() => orderDateTimestamp(date), /fecha válida/);
  }
});
