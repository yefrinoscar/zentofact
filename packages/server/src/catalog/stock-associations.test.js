import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignUnmatchedStockItem,
  listUnmatchedStockItems,
} from './stock-associations.js';
import { INVENTORY_LISTEN_FROM_AT } from './stock-commitment.js';

test('lista seller SKUs sin producto maestro desde el corte operativo', async () => {
  let sql = '';
  let params = [];
  const rows = await listUnmatchedStockItems({
    async query(text, values) {
      sql = String(text);
      params = values;
      return {
        rows: [{
          order_item_id: '91', company_id: 4, company: 'LIMBO', channel_code: 'falabella',
          channel_account_id: '12', seller_sku: 'S126695', shop_sku: 'PMP20000722586-1',
          title: 'Camiseta reductora', line_count: 2, quantity: '2',
          order_numbers: ['7934119901', '7934178001'],
        }],
      };
    },
  });

  assert.equal(params[0], INVENTORY_LISTEN_FROM_AT);
  assert.doesNotMatch(sql, /where\s+oi\.stock_state='skipped_unmapped'/i);
  assert.match(sql, /product_id is null/i);
  assert.deepEqual(rows, [{
    orderItemId: 91,
    companyId: 4,
    company: 'LIMBO',
    channelCode: 'falabella',
    channelAccountId: 12,
    sellerSku: 'S126695',
    shopSku: 'PMP20000722586-1',
    title: 'Camiseta reductora',
    lineCount: 2,
    quantity: 2,
    orderNumbers: ['7934119901', '7934178001'],
  }]);
});

test('asocia el seller SKU, repara todas sus líneas y reencola cada pedido', async () => {
  const enqueued = [];
  const listingInputs = [];
  const db = {
    async query(text, values = []) {
      const sql = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
      if (sql.includes('from order_items oi') && sql.includes('for update of oi')) {
        return { rows: [{
          order_item_id: '91', company_id: 4, channel_account_id: '12',
          channel_code: 'falabella', seller_sku: 'S126695',
          shop_sku: 'PMP20000722586-1', title: 'Camiseta reductora',
          product_id: null, stock_state: 'skipped_policy',
        }] };
      }
      if (sql.startsWith('select id, main_sku, name from products')) {
        return { rows: [{ id: '33', main_sku: 'CAM-RED-M', name: 'Camiseta reductora M' }] };
      }
      if (sql.startsWith('update order_items oi')) {
        assert.equal(values[0], 71);
        assert.equal(values[1], 33);
        assert.equal(values[2], 'CAM-RED-M');
        assert.equal(values[5], 12);
        return { rows: [
          { order_item_id: '91', order_id: '501', company_id: 4, external_order_id: 'A', order_number: '7934119901' },
          { order_item_id: '92', order_id: '502', company_id: 4, external_order_id: 'B', order_number: '7934178001' },
        ] };
      }
      throw new Error(`Query no simulada: ${sql}`);
    },
  };

  const result = await assignUnmatchedStockItem({ orderItemId: 91, productId: 33 }, db, {
    upsertListing: async (productId, input) => {
      listingInputs.push({ productId, input });
      return { id: 71, productId };
    },
    enqueue: async (input) => {
      enqueued.push(input);
      return { enqueued: true };
    },
  });

  assert.deepEqual(listingInputs, [{
    productId: 33,
    input: {
      companyId: 4,
      channelAccountId: 12,
      channelCode: 'falabella',
      sellerSku: 'S126695',
      shopSku: 'PMP20000722586-1',
      title: 'Camiseta reductora',
      metadata: { source: 'stock_unmatched_assignment', orderItemId: 91 },
    },
  }]);
  assert.deepEqual(enqueued.map((item) => ({ orderId: item.orderId, source: item.source })), [
    { orderId: 501, source: 'association' },
    { orderId: 502, source: 'association' },
  ]);
  assert.equal(result.updatedItems, 2);
  assert.equal(result.ordersQueued, 2);
  assert.equal(result.product.mainSku, 'CAM-RED-M');
});
