const test = require('node:test');
const assert = require('node:assert/strict');

const { recordFalabellaLabelPrint } = require('../dist/services/falabella-label-print.service.js');

test('registra e incrementa cada etiqueta por empresa, OrderId e índice', async () => {
  const calls = [];
  const db = {
    async query(sql, values) {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), values });
      return {
        rows: [{
          label_index: '2',
          print_count: '4',
          first_printed_at: new Date('2026-07-30T14:05:00.000Z'),
          last_printed_at: new Date('2026-07-30T16:30:00.000Z'),
        }, {
          label_index: '1',
          print_count: '3',
          first_printed_at: new Date('2026-07-30T14:00:00.000Z'),
          last_printed_at: new Date('2026-07-30T16:30:00.000Z'),
        }],
      };
    },
  };

  const result = await recordFalabellaLabelPrint(9, '3246544958', 2, db);

  assert.deepEqual(result, [{
    labelIndex: 1,
    printCount: 3,
    firstPrintedAt: '2026-07-30T14:00:00.000Z',
    lastPrintedAt: '2026-07-30T16:30:00.000Z',
  }, {
    labelIndex: 2,
    printCount: 4,
    firstPrintedAt: '2026-07-30T14:05:00.000Z',
    lastPrintedAt: '2026-07-30T16:30:00.000Z',
  }]);
  assert.deepEqual(calls[0].values, [9, '3246544958', 2]);
  assert.match(calls[0].sql, /generate_series\(1, \$3::int\)/);
  assert.match(calls[0].sql, /on conflict \(company_id, order_id, label_index\) do update/);
  assert.match(calls[0].sql, /print_count=falabella_label_prints\.print_count \+ 1/);
});

test('no registra una impresión huérfana', async () => {
  const db = { async query() { return { rows: [] }; } };
  await assert.rejects(
    recordFalabellaLabelPrint(9, 'inexistente', 1, db),
    /el pedido no existe/,
  );
});
