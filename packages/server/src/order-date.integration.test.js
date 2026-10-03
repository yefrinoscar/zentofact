import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { updateOrderDate, ingestOrder } from './order-management.js';

const connectionString = process.env.ORDER_DATE_TEST_DATABASE_URL;

test('PostgreSQL: fecha, administrador y actividad se guardan juntos y sobreviven al sync', { skip: !connectionString }, async () => {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(connectionString).hostname), 'Usa solo una base de prueba local.');
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('begin');
    const { rows: [order] } = await client.query(`select o.* from orders o
      join order_channel_accounts a on a.id=o.channel_account_id
      where a.active=true order by o.id limit 1`);
    assert.ok(order, 'Se necesita un pedido de prueba local.');
    const { rows: [admin] } = await client.query(`select id, name from "user" where role in ('admin', 'superadmin') limit 1`);
    assert.ok(admin);
    const updated = await updateOrderDate(order.id, { orderDate: '2026-10-01', actorUserId: admin.id }, client);
    assert.equal(new Date(updated.orderedAt).toISOString(), '2026-10-01T17:00:00.000Z');
    const event = updated.events.findLast((entry) => entry.eventType === 'order.date_changed');
    assert.equal(event.actorUserId, admin.id);
    assert.equal(event.actorName, admin.name);
    assert.equal(new Date(event.previousValues.orderedAt).toISOString(), new Date(order.ordered_at || order.created_at).toISOString());
    assert.equal(new Date(event.newValues.orderedAt).toISOString(), '2026-10-01T17:00:00.000Z');
    assert.equal(event.payload.dateConfirmed, true);
    assert.equal(event.payload.dateFinalConfirmed, true);
    assert.equal(new Date(updated.promisedShippingAt).toISOString(), new Date(order.promised_shipping_at).toISOString());
    const synced = await ingestOrder({
      channelAccountId: order.channel_account_id,
      externalOrderId: order.external_order_id,
      externalOrderNumber: order.external_order_number,
      source: 'sync',
      orderedAt: '2026-10-03T18:00:00.000Z',
      providerUpdatedAt: '2099-01-01T00:00:00Z',
      orderStatus: order.order_status,
      fulfillmentStatus: order.fulfillment_status,
      total: order.total,
    }, client);
    assert.equal(new Date(synced.order.orderedAt).toISOString(), '2026-10-01T17:00:00.000Z');
    assert.equal(await updateOrderDate(2147483647, { orderDate: '2026-10-01', actorUserId: admin.id }, client), null);
  } finally {
    await client.query('rollback');
    await client.end();
  }
});
