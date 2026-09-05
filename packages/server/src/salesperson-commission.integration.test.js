import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { getSalespersonHome } from './order-management.js';

test('Mis ventas suma la comisión del catálogo por unidad y respeta vendedor, estado y paginación', {
  skip: !process.env.SALESPERSON_TEST_DATABASE_URL && 'define SALESPERSON_TEST_DATABASE_URL',
}, async () => {
  const db = new Pool({ connectionString: process.env.SALESPERSON_TEST_DATABASE_URL, max: 1 });
  try {
    await db.query(`begin;
      create temporary table products (id int, commission_amount numeric);
      create temporary table "user" (id text, commission_percent numeric);
      create temporary table companies (id int);
      create temporary table order_channels (id int, code text, name text);
      create temporary table order_channel_accounts (id int, channel_id int, display_name text);
      create temporary table orders (
        id int, company_id int, channel_account_id int, created_by text,
        order_status text default 'confirmed', payment_status text default 'paid',
        fulfillment_status text default 'pending', total numeric, metadata jsonb default '{}',
        ordered_at timestamptz default now(), created_at timestamptz default now()
      );
      create temporary table order_items (order_id int, product_id int, quantity numeric);
      insert into "user" values ('seller', 10), ('other', 0);
      insert into products values (1, 7.50), (2, 3), (3, 0), (4, null);
      insert into companies values (1);
      insert into order_channels values (1, 'manual', 'Manual');
      insert into order_channel_accounts values (1, 1, 'Manual');
      insert into orders (id, company_id, channel_account_id, created_by, total) values
        (1,1,1,'seller',200), (2,1,1,'seller',400), (3,1,1,'other',900),
        (4,1,1,'seller',800), (5,1,1,'seller',100);
      update orders set fulfillment_status='cancelled' where id=4;
      insert into order_items values (1,1,2), (1,2,1), (2,3,1), (3,1,10), (4,1,20), (5,4,1);
    `);
    const home = await getSalespersonHome({ userId: 'seller', commissionPercent: 10, sortBy: 'commission', sortDir: 'desc', limit: 2 }, db);
    assert.equal(home.today.orders, 3);
    assert.equal(home.today.commission, 28);
    assert.equal(home.month.commission, 28);
    assert.equal(home.daily.at(-1).commission, 28);
    assert.equal(home.ordersTotal, 3);
    assert.deepEqual(home.orders.map(({ id, commission }) => ({ id, commission })), [
      { id: 1, commission: 18 }, { id: 5, commission: 10 },
    ]);
    const page = await getSalespersonHome({ userId: 'seller', commissionPercent: 10, sortBy: 'commission', sortDir: 'desc', limit: 2, offset: 2 }, db);
    assert.equal(page.orders[0].commission, 0);
    await db.query('update products set commission_amount=8 where id=1');
    const updated = await getSalespersonHome({ userId: 'seller', commissionPercent: 10 }, db);
    assert.equal(updated.today.commission, 29);
    await db.query("update \"user\" set commission_percent=0 where id='seller'");
    const withoutPercent = await getSalespersonHome({ userId: 'seller' }, db);
    assert.equal(withoutPercent.today.commission, 19);
  } finally {
    await db.query('rollback');
    await db.end();
  }
});
