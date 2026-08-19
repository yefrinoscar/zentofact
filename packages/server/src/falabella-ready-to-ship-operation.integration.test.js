import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { markFalabellaOrderReadyToShip } from './falabella-ready-to-ship-operation.js';

const connectionString = process.env.READY_TO_SHIP_TEST_DATABASE_URL;

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

async function insertOrder(pool, orderId) {
  await pool.query(
    `insert into falabella_orders (
       company_id, order_id, order_number, status, raw_data
     ) values (7, $1, $1, 'pending', '{"Statuses":"pending"}'::jsonb)`,
    [orderId],
  );
}

test('PostgreSQL real: concurrencia, estado terminal y reconciliación no agotan el pool', {
  skip: !connectionString && 'define READY_TO_SHIP_TEST_DATABASE_URL para ejecutar la integración',
}, async () => {
  const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 1_000 });
  try {
    await pool.query(`
      create table falabella_orders (
        company_id integer not null,
        order_id text not null,
        order_number text not null,
        falabella_created_at timestamptz,
        falabella_updated_at timestamptz,
        status text,
        raw_data jsonb not null default '{}'::jsonb,
        first_seen_at timestamptz not null default now(),
        last_seen_at timestamptz not null default now(),
        synchronized_at timestamptz not null default now(),
        unique (company_id, order_id)
      );
      create table falabella_order_lifecycle (
        id bigserial primary key,
        company_id integer not null,
        order_id text not null,
        order_number text not null,
        current_status text not null default '',
        pending_at timestamptz,
        ready_to_ship_at timestamptz,
        shipped_at timestamptz,
        last_provider_update_at timestamptz,
        first_observed_at timestamptz not null default now(),
        last_observed_at timestamptz not null default now(),
        unique (company_id, order_id)
      );
      create table falabella_ready_to_ship_operations (
        company_id integer not null,
        order_id text not null,
        state text not null,
        attempts integer not null default 1,
        started_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        finished_at timestamptz,
        last_error text,
        result jsonb not null default '{}'::jsonb,
        primary key (company_id, order_id),
        foreign key (company_id, order_id)
          references falabella_orders(company_id, order_id) on delete cascade,
        check (state in ('processing', 'reconciling', 'succeeded', 'failed', 'unknown'))
      );
    `);

    await insertOrder(pool, 'ORDER-CONCURRENT');
    const provider = deferred();
    const providerStarted = deferred();
    let providerCalls = 0;
    const input = {
      pool,
      companyId: 7,
      orderId: 'ORDER-CONCURRENT',
      setReadyToShip: async () => {
        providerCalls += 1;
        providerStarted.resolve();
        return provider.promise;
      },
    };
    const owner = markFalabellaOrderReadyToShip(input);
    await providerStarted.promise;
    const duplicates = await Promise.race([
      Promise.all(Array.from({ length: 9 }, () => markFalabellaOrderReadyToShip(input))),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 500)),
    ]);
    assert.notEqual(duplicates, 'timeout');
    assert.equal(providerCalls, 1);
    assert.ok(duplicates.every((outcome) => outcome.kind === 'in_progress'));
    assert.equal(pool.totalCount - pool.idleCount, 0, 'el proveedor no debe retener conexiones PostgreSQL');
    provider.resolve({ ok: true, alreadyReady: false });
    assert.equal((await owner).kind, 'success');

    await insertOrder(pool, 'ORDER-TERMINAL-RACE');
    await pool.query(
      `insert into falabella_order_lifecycle (
         company_id, order_id, order_number, current_status, pending_at
       ) values (7, 'ORDER-TERMINAL-RACE', 'ORDER-TERMINAL-RACE', 'pending', now())`,
    );
    const terminalProvider = deferred();
    const terminalStarted = deferred();
    const terminalOwner = markFalabellaOrderReadyToShip({
      pool,
      companyId: 7,
      orderId: 'ORDER-TERMINAL-RACE',
      setReadyToShip: async () => {
        terminalStarted.resolve();
        return terminalProvider.promise;
      },
    });
    await terminalStarted.promise;
    await pool.query(
      `update falabella_orders
       set status='shipped', raw_data='{"Statuses":"shipped"}'::jsonb
       where company_id=7 and order_id='ORDER-TERMINAL-RACE'`,
    );
    terminalProvider.resolve({ ok: true, alreadyReady: false });
    assert.equal((await terminalOwner).kind, 'success');
    const terminal = await pool.query(
      `select orders.status, lifecycle.current_status, lifecycle.shipped_at
       from falabella_orders orders
       join falabella_order_lifecycle lifecycle using (company_id, order_id)
       where orders.company_id=7 and orders.order_id='ORDER-TERMINAL-RACE'`,
    );
    assert.equal(terminal.rows[0].status, 'shipped');
    assert.equal(terminal.rows[0].current_status, 'shipped');
    assert.ok(terminal.rows[0].shipped_at);

    await insertOrder(pool, 'ORDER-UNKNOWN');
    const timeoutOutcome = await markFalabellaOrderReadyToShip({
      pool,
      companyId: 7,
      orderId: 'ORDER-UNKNOWN',
      providerTimeoutMs: 5,
      setReadyToShip: async () => new Promise(() => {}),
    });
    assert.equal(timeoutOutcome.status, 504);
    await pool.query(
      `update falabella_ready_to_ship_operations
       set updated_at=now() - interval '2 minutes'
       where company_id=7 and order_id='ORDER-UNKNOWN'`,
    );
    let repeatedPosts = 0;
    const reconciled = await markFalabellaOrderReadyToShip({
      pool,
      companyId: 7,
      orderId: 'ORDER-UNKNOWN',
      reconcileAfterMs: 60_000,
      setReadyToShip: async () => {
        repeatedPosts += 1;
        return { ok: true };
      },
      reconcile: async () => ({ ok: true, ready: true, providerStatus: 'ready_to_ship' }),
    });
    assert.equal(reconciled.kind, 'success');
    assert.equal(reconciled.result.reconciled, true);
    assert.equal(repeatedPosts, 0);
    const reconciledOrder = await pool.query(
      `select orders.status, lifecycle.ready_to_ship_at, lifecycle.shipped_at
       from falabella_orders orders
       join falabella_order_lifecycle lifecycle using (company_id, order_id)
       where orders.company_id=7 and orders.order_id='ORDER-UNKNOWN'`,
    );
    assert.equal(reconciledOrder.rows[0].status, 'ready_to_ship');
    assert.ok(reconciledOrder.rows[0].ready_to_ship_at);
    assert.equal(reconciledOrder.rows[0].shipped_at, null);
  } finally {
    await pool.end();
  }
});
