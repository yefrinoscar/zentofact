import test from 'node:test';
import assert from 'node:assert/strict';
import { importSettlementCsv } from './pagos.js';

const CSV = [
  'Fecha de transacción;Tipo de transacción;N.° de pedido;SKU del vendedor;Monto',
  '27/08/2026;Sales;PV-10002;AG301;189.90',
].join('\n');

test('reimportar el mismo CSV reusa el import y no vuelve a insertar', async () => {
  const db = {
    query: async (sql) => {
      if (sql.includes('file_sha256')) {
        return {
          rows: [{
            id: 9,
            filename: 'estado.csv',
            file_sha256: 'abc',
            company_id: null,
            imported_at: '2026-08-27T12:00:00.000Z',
            imported_by: 'admin',
            line_count: 1,
            matched_count: 1,
            unmatched_count: 0,
            paid_sales_count: 1,
            reused: true,
          }],
        };
      }
      throw new Error(`query inesperada: ${sql}`);
    },
  };
  const result = await importSettlementCsv({ filename: 'estado.csv', csv: CSV }, db);
  assert.equal(result.reused, true);
  assert.equal(result.id, 9);
  assert.equal(result.matchedCount, 1);
});

test('la primera carga cruza por ID de orden y marca la venta pagada', async () => {
  const inserts = [];
  const db = {
    query: async (sql) => {
      if (sql.includes('file_sha256') && sql.includes('from settlement_imports')) return { rows: [] };
      if (sql.includes('from falabella_orders')) {
        return {
          rows: [{
            id: 2,
            company_id: 1,
            order_id: 'preview-seed-shipped',
            order_number: 'PV-10002',
            sale_date: '2026-08-27',
            amount: 189.9,
            skus: ['ag301'],
          }],
        };
      }
      return { rows: [] };
    },
    connect: async () => ({
      query: async (sql, params) => {
        inserts.push(sql);
        if (sql.includes('insert into settlement_imports')) {
          return {
            rows: [{
              id: 1,
              filename: params[0],
              file_sha256: params[1],
              company_id: params[2],
              imported_at: '2026-08-27T12:00:00.000Z',
              imported_by: params[3],
              line_count: params[5],
              matched_count: params[6],
              unmatched_count: params[7],
              paid_sales_count: params[8],
            }],
          };
        }
        return { rows: [] };
      },
      release() {},
    }),
  };
  const result = await importSettlementCsv({ filename: 'estado.csv', csv: CSV, importedBy: 'admin' }, db);
  assert.equal(result.reused, false);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.paidSalesCount, 1);
  assert.equal(inserts.some((sql) => sql.includes('insert into sale_settlements')), true);
});
