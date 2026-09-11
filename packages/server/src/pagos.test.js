import test from 'node:test';
import assert from 'node:assert/strict';
import { clearSettlementSalesCache, importSettlementCsv, listSettlementSales, loadSettlementSalesForOrders, settlementSalesLimit, SETTLEMENT_SALES_LIST_MAX, SETTLEMENT_SALES_PAGE_DEFAULT, SETTLEMENT_SALES_PAGE_MAX, shouldCacheSettlementSales } from './pagos.js';

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

const UNPAID_CSV = [
  'Fecha de transacción;Tipo de transacción;N.° de pedido;SKU del vendedor;Monto;Estado de pago',
  '27/08/2026;Sales;PV-10002;AG301;189.90;No Pagado',
].join('\n');

test('No Pagado cruza el pedido e inserta liquidación pendiente', async () => {
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
        inserts.push({ sql, params });
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
  const result = await importSettlementCsv({ filename: 'no-pagado.csv', csv: UNPAID_CSV, importedBy: 'admin' }, db);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.paidSalesCount, 0);
  const settlement = inserts.find((row) => row.sql.includes('insert into sale_settlements'));
  assert.equal(Boolean(settlement), true);
  assert.equal(settlement.params[2], 'pending');
  assert.match(settlement.sql, /sale_settlements\.status = 'pending'/);
});

test('Pagos pagina las ventas y no entrega el catálogo entero', () => {
  assert.equal(SETTLEMENT_SALES_LIST_MAX, 20000);
  assert.equal(SETTLEMENT_SALES_PAGE_DEFAULT, 80);
  assert.equal(SETTLEMENT_SALES_PAGE_MAX, 200);
  assert.equal(settlementSalesLimit(undefined), 80);
  assert.equal(settlementSalesLimit(100), 100);
  assert.equal(settlementSalesLimit(200), 200);
  assert.equal(settlementSalesLimit(20000), 200);
  assert.equal(settlementSalesLimit(90000), 200);
  assert.equal(settlementSalesLimit(0), 80);
});

test('reemplazar un CSV ya cruzado borra las líneas y vuelve a cruzar', async () => {
  const calls = [];
  const db = {
    query: async (sql) => {
      if (sql.includes('file_sha256') && sql.includes('from settlement_imports')) {
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
        calls.push(sql);
        if (sql.includes('update settlement_imports')) {
          return {
            rows: [{
              id: 9,
              filename: params[1],
              file_sha256: 'abc',
              company_id: null,
              imported_at: '2026-08-27T13:00:00.000Z',
              imported_by: params[2],
              line_count: params[4],
              matched_count: params[5],
              unmatched_count: params[6],
              paid_sales_count: params[7],
              reused: false,
              replaced: true,
            }],
          };
        }
        return { rows: [] };
      },
      release() {},
    }),
  };
  const result = await importSettlementCsv({
    filename: 'estado.csv',
    csv: CSV,
    replace: true,
    importedBy: 'admin',
  }, db);
  assert.equal(result.replaced, true);
  assert.equal(result.reused, false);
  assert.equal(result.id, 9);
  assert.equal(calls.some((sql) => sql.includes('delete from settlement_lines')), true);
  assert.equal(calls.some((sql) => sql.includes('update settlement_imports')), true);
  assert.equal(calls.some((sql) => sql.includes('insert into settlement_lines')), true);
  assert.equal(calls.some((sql) => sql.includes('insert into sale_settlements')), true);
});

test('Pagos agrega todas las líneas del estado de cuenta, sin tope de 10000', async () => {
  const extra = 12;
  const lineCount = 10000 + extra;
  const rows = Array.from({ length: lineCount }, (_, index) => ({
    id: index + 1,
    import_id: 1,
    row_number: index + 1,
    match_status: 'matched',
    match_method: 'order_id',
    match_reason: null,
    order_ref: `ORD-${String(index + 1).padStart(5, '0')}`,
    sku: 'AG301',
    sale_date: '2026-08-01',
    transaction_type: 'Pago por precio del producto',
    kind: 'sale',
    payment_status: 'Pagado',
    item_id: `item-${index + 1}`,
    bruto: 10,
    commission: 0,
    other_fees: 0,
    neto: 10,
    raw: {},
    sale_order_number: `ORD-${String(index + 1).padStart(5, '0')}`,
    match_company_id: 1,
    import_company_id: 1,
  }));
  let listSql = '';
  const result = await listSettlementSales({ limit: 50 }, {
    query: async (sql) => {
      if (sql.includes('from settlement_lines') && sql.includes('sale_order_number')) {
        listSql = sql;
        return { rows };
      }
      return { rows: [] };
    },
  });
  assert.match(listSql, /from settlement_lines/);
  assert.equal(/limit\s+10000\b/i.test(listSql), false);
  assert.equal(/sl\.raw,/.test(listSql), false);
  assert.equal(result.summary.saleCount, lineCount);
  assert.equal(result.totalCount, lineCount);
  assert.equal(result.summary.bruto, lineCount * 10);
  assert.equal(result.items.length, 50);
  assert.equal(result.items[0].charges, undefined);
  assert.equal(result.items[0].items, undefined);
  assert.equal(result.items[0].invoiceCharges, undefined);
  assert.ok(Array.isArray(result.days));
  assert.equal(result.days.length, 1);
  assert.equal(result.days[0].facturado, lineCount * 10);

  const defaultPage = await listSettlementSales({}, {
    query: async (sql) => {
      if (sql.includes('from settlement_lines') && sql.includes('sale_order_number')) {
        return { rows };
      }
      return { rows: [] };
    },
  });
  assert.equal(defaultPage.items.length, SETTLEMENT_SALES_PAGE_DEFAULT);
  assert.equal(defaultPage.totalCount, lineCount);
  assert.equal(defaultPage.summary.saleCount, lineCount);
  assert.equal(defaultPage.items[0].charges, undefined);

  const firstPage = await listSettlementSales({ limit: 80 }, {
    query: async (sql) => {
      if (sql.includes('from settlement_lines') && sql.includes('sale_order_number')) {
        return { rows };
      }
      return { rows: [] };
    },
  });
  const secondPage = await listSettlementSales({ limit: 80, offset: 80 }, {
    query: async (sql) => {
      if (sql.includes('from settlement_lines') && sql.includes('sale_order_number')) {
        return { rows };
      }
      return { rows: [] };
    },
  });
  assert.equal(firstPage.items.length, 80);
  assert.equal(secondPage.items.length, 80);
  assert.equal(firstPage.summary.saleCount, lineCount);
  assert.equal(secondPage.summary.saleCount, lineCount);
  assert.equal(firstPage.summary.bruto, secondPage.summary.bruto);
  assert.notEqual(firstPage.items[0].orderId, secondPage.items[0].orderId);

  const augustRows = rows.map((row, index) => ({
    ...row,
    sale_date: index % 4 === 0 ? '2026-07-15' : '2026-08-01',
  }));
  const august = await listSettlementSales({ orderMonth: '2026-08', limit: 80 }, {
    query: async (sql) => {
      if (sql.includes('from settlement_lines') && sql.includes('sale_order_number')) {
        return { rows: augustRows };
      }
      return { rows: [] };
    },
  });
  assert.equal(august.totalCount, lineCount - Math.ceil(lineCount / 4));
  assert.equal(august.items.length, 80);
  assert.ok(august.items.every((sale) => String(sale.date).startsWith('2026-08')));
  assert.deepEqual(august.orderMonths, ['2026-08', '2026-07']);
});

function productionSaleRows(saleCount, linesPerSale = 1) {
  const rows = [];
  for (let sale = 0; sale < saleCount; sale += 1) {
    const orderRef = `3247${String(sale + 1).padStart(6, '0')}`;
    for (let line = 0; line < linesPerSale; line += 1) {
      const kinds = ['sale', 'commission', 'shipping', 'sale', 'commission'];
      const kind = kinds[line] || 'sale';
      const amount = kind === 'sale' ? 19.9 : kind === 'commission' ? -2.4 : -1.1;
      rows.push({
        id: rows.length + 1,
        import_id: 1,
        row_number: rows.length + 1,
        match_status: 'matched',
        match_method: 'order_id',
        match_reason: null,
        order_ref: orderRef,
        sku: 'PÑL12309854',
        sale_date: sale % 5 === 0 ? '2026-07-02' : '2026-08-02',
        transaction_type: kind === 'commission' ? 'Cobro por comisión por venta' : kind === 'shipping' ? 'Cobro por logística' : 'Pago por precio del producto',
        kind,
        payment_status: 'Pagado',
        item_id: `item-${sale + 1}`,
        bruto: kind === 'sale' ? amount : 0,
        commission: kind === 'commission' ? Math.abs(amount) : 0,
        other_fees: 0,
        neto: amount,
        raw: { 'Nombre del producto': 'Pañalera' },
        sale_order_number: orderRef,
        match_company_id: 1,
        import_company_id: 1,
      });
    }
  }
  return rows;
}

function snapshotListDb(rows) {
  const snapshot = { row: null };
  const stats = { lineReads: 0, shippingReads: 0, snapshotReads: 0, snapshotWrites: 0 };
  const stamp = {
    line_max_id: rows[rows.length - 1]?.id || 0,
    import_max_id: 1,
    import_count: 1,
  };
  return {
    useSettlementSalesCache: true,
    stats,
    query: async (sql, params = []) => {
      if (sql.includes('pg_advisory')) return { rows: [{}] };
      if (sql.includes('as line_max_id')) return { rows: [stamp] };
      if (sql.includes('from settlement_sales_snapshot') && sql.includes('select sales')) {
        stats.snapshotReads += 1;
        if (!snapshot.row) return { rows: [] };
        if (Number(params[0]) !== Number(snapshot.row.line_max_id)) return { rows: [] };
        return { rows: [{ sales: snapshot.row.sales }] };
      }
      if (sql.includes('insert into settlement_sales_snapshot')) {
        stats.snapshotWrites += 1;
        snapshot.row = {
          line_max_id: params[0],
          import_max_id: params[1],
          import_count: params[2],
          sales: JSON.parse(params[4]),
        };
        return { rows: [] };
      }
      if (sql.includes('from settlement_lines') && sql.includes('sale_order_number')) {
        stats.lineReads += 1;
        return { rows };
      }
      if (sql.includes('from orders o')) {
        stats.shippingReads += 1;
        assert.match(sql, /union/i);
        assert.equal(/or o\.external_order_number/i.test(sql), false);
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

test('el cache de Pagos no se activa en los mocks de listado', () => {
  assert.equal(shouldCacheSettlementSales(null), true);
  assert.equal(shouldCacheSettlementSales({}), false);
  assert.equal(shouldCacheSettlementSales({ useSettlementSalesCache: true }), true);
});

test('Pagos reusa el snapshot con 4608 ventas y no vuelve a leer líneas', async () => {
  const saleCount = 4608;
  const rows = productionSaleRows(saleCount, 3);
  const db = snapshotListDb(rows);
  const first = await listSettlementSales({ limit: 80 }, db);
  assert.equal(first.totalCount, saleCount);
  assert.equal(first.items.length, 80);
  assert.equal(first.summary.saleCount, saleCount);
  assert.equal(db.stats.lineReads, 1);
  assert.equal(db.stats.shippingReads, 1);
  assert.equal(db.stats.snapshotWrites, 1);
  assert.ok(first.items[0].orderShipping === null || first.items[0].orderShipping === undefined || Number.isFinite(first.items[0].orderShipping));
  assert.equal(first.items[0].charges, undefined);

  clearSettlementSalesCache();
  const second = await listSettlementSales({ limit: 80, offset: 80 }, db);
  assert.equal(second.totalCount, saleCount);
  assert.equal(second.items.length, 80);
  assert.notEqual(second.items[0].orderId, first.items[0].orderId);
  assert.equal(second.summary.bruto, first.summary.bruto);
  assert.equal(db.stats.lineReads, 1);
  assert.equal(db.stats.shippingReads, 1);
  assert.equal(db.stats.snapshotReads >= 1, true);

  const august = await listSettlementSales({ orderMonth: '2026-08', limit: 80 }, db);
  assert.equal(august.totalCount, saleCount - Math.ceil(saleCount / 5));
  assert.ok(august.items.every((sale) => String(sale.date).startsWith('2026-08')));
  assert.equal(db.stats.lineReads, 1);
  assert.deepEqual(august.orderMonths, ['2026-08', '2026-07']);
});

test('carga las ventas del estado de cuenta por pedido de la factura', async () => {
  const sales = await loadSettlementSalesForOrders(['3249715842'], {
    query: async (sql, params) => {
      assert.match(sql, /order_ref = any/);
      assert.deepEqual(params[0], ['3249715842']);
      return {
        rows: [{
          id: 1,
          import_id: 3,
          row_number: 1,
          match_status: 'matched',
          match_method: 'order_id',
          match_reason: null,
          order_ref: '3249715842',
          sku: 'MN1',
          sale_date: '2026-08-22',
          transaction_type: 'Cobro por comisión por venta',
          kind: 'commission',
          payment_status: 'Pagado',
          item_id: 'item-1',
          bruto: 0,
          commission: 17.69,
          other_fees: 0,
          neto: -17.69,
          raw: { 'Nombre del producto': 'Mesa de Noche' },
          sale_order_number: '3249715842',
          match_company_id: 1,
          import_company_id: 1,
        }],
      };
    },
  });
  assert.equal(sales.length, 1);
  assert.equal(sales[0].orderId, '3249715842');
  assert.equal(sales[0].commission, 17.69);
  assert.deepEqual(await loadSettlementSalesForOrders([]), []);
});
