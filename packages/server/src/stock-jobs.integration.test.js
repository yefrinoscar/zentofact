import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import {
  enqueueStockJob,
  ensureStockJobTables,
  processStockQueue,
} from './catalog/stock-jobs.js';

const connectionString = process.env.STOCK_JOBS_TEST_DATABASE_URL;

function schemaName() {
  return `stock_jobs_test_${process.pid}_${Date.now()}`;
}

async function queueRows(db, companyId, externalOrderId) {
  return (await db.query(
    `select * from inventory_stock_jobs
     where company_id=$1 and external_order_id=$2 order by id`,
    [companyId, externalOrderId],
  )).rows;
}

test('PostgreSQL real: la identidad de stock converge y no procesa duplicados', {
  skip: !connectionString && 'define STOCK_JOBS_TEST_DATABASE_URL para ejecutar la integración',
}, async () => {
  const schema = schemaName();
  const admin = new Pool({ connectionString, max: 2 });
  await admin.query(`create schema ${schema}`);
  const pool = new Pool({
    connectionString,
    max: 25,
    options: `-c search_path=${schema}`,
  });
  try {
    await pool.query(`
      create table orders (
        id bigserial primary key,
        company_id integer not null,
        external_order_id text not null,
        external_order_number text not null
      )
    `);
    await ensureStockJobTables(pool);

    await pool.query(
      `insert into orders (id, company_id, external_order_id, external_order_number)
       values (101, 4, 'UNIQUE', 'ORDER-UNIQUE')`,
    );
    await Promise.all(Array.from({ length: 20 }, () => enqueueStockJob({
      companyId: 4,
      externalOrderId: 'UNIQUE',
      orderNumber: 'ORDER-UNIQUE',
      source: 'integration',
    }, pool)));
    const unique = await queueRows(pool, 4, 'UNIQUE');
    assert.equal(unique.length, 1);
    assert.equal(Number(unique[0].order_id), 101);

    await Promise.all(Array.from({ length: 5 }, () => enqueueStockJob({
      companyId: 4,
      externalOrderId: 'MISSING',
      source: 'integration',
    }, pool)));
    const missing = await queueRows(pool, 4, 'MISSING');
    assert.equal(missing.length, 1);
    assert.equal(missing[0].order_id, null);
    const legacyJobId = Number(missing[0].id);
    await pool.query(
      `insert into orders (id, company_id, external_order_id, external_order_number)
       values (150, 4, 'MISSING', 'ORDER-LATE')`,
    );
    await enqueueStockJob({
      companyId: 4,
      externalOrderId: 'MISSING',
      source: 'integration',
    }, pool);
    const promoted = await queueRows(pool, 4, 'MISSING');
    assert.equal(promoted.length, 1);
    assert.equal(Number(promoted[0].id), legacyJobId);
    assert.equal(Number(promoted[0].order_id), 150);

    await pool.query(
      `insert into orders (id, company_id, external_order_id, external_order_number)
       values (201, 4, 'AMBIGUOUS', 'ORDER-A'), (202, 4, 'AMBIGUOUS', 'ORDER-B')`,
    );
    await Promise.all(Array.from({ length: 5 }, () => enqueueStockJob({
      companyId: 4,
      externalOrderId: 'AMBIGUOUS',
      source: 'integration',
    }, pool)));
    const ambiguous = await queueRows(pool, 4, 'AMBIGUOUS');
    assert.equal(ambiguous.length, 1);
    assert.equal(ambiguous[0].order_id, null);
    await pool.query(
      `update inventory_stock_jobs
       set status='skipped', result='{"supersededByOrderId":201}'::jsonb
       where id=$1`,
      [ambiguous[0].id],
    );
    await enqueueStockJob({
      companyId: 4,
      externalOrderId: 'AMBIGUOUS',
      source: 'integration',
    }, pool);
    assert.equal((await queueRows(pool, 4, 'AMBIGUOUS'))[0].status, 'pending');

    await pool.query(
      `insert into orders (id, company_id, external_order_id, external_order_number)
       values (250, 4, 'AMBIGUOUS-WITH-CANONICAL', 'ORDER-A'),
              (251, 4, 'AMBIGUOUS-WITH-CANONICAL', 'ORDER-B')`,
    );
    await pool.query(
      `insert into inventory_stock_jobs (
         order_id, company_id, external_order_id, order_number, status, source
       ) values
         (250, 4, 'AMBIGUOUS-WITH-CANONICAL', 'ORDER-A', 'done', 'canonical'),
         (null, 4, 'AMBIGUOUS-WITH-CANONICAL', 'ORDER-B', 'pending', 'legacy')`,
    );
    await ensureStockJobTables(pool);
    const ambiguousWithCanonical = await queueRows(pool, 4, 'AMBIGUOUS-WITH-CANONICAL');
    assert.equal(ambiguousWithCanonical.find((row) => Number(row.order_id) === 251), undefined);
    assert.equal(ambiguousWithCanonical.find((row) => row.order_id == null)?.status, 'pending');

    await pool.query('truncate inventory_stock_jobs restart identity');
    await pool.query(
      `insert into orders (id, company_id, external_order_id, external_order_number)
       values (301, 4, 'DUAL', 'ORDER-DUAL')`,
    );
    await pool.query(
      `insert into inventory_stock_jobs (
         order_id, company_id, external_order_id, order_number, status, source
       ) values
         (301, 4, 'DUAL', 'ORDER-DUAL', 'pending', 'canonical'),
         (null, 4, 'DUAL', 'ORDER-DUAL', 'pending', 'legacy')`,
    );
    await ensureStockJobTables(pool);
    await ensureStockJobTables(pool);
    const dual = await queueRows(pool, 4, 'DUAL');
    assert.equal(dual.filter((row) => row.order_id != null).length, 1);
    assert.equal(
      dual.filter((row) => row.order_id == null && ['pending', 'processing', 'failed'].includes(row.status)).length,
      0,
    );
    const applied = [];
    const processed = await processStockQueue({
      apply: async (input) => {
        applied.push(input.orderId);
        return { applied: 1, skipped: 0 };
      },
    }, pool);
    assert.equal(processed.claimed, 1);
    assert.deepEqual(applied, [301]);

    await pool.query('truncate inventory_stock_jobs restart identity');
    await pool.query(
      `insert into orders (id, company_id, external_order_id, external_order_number)
       values (303, 4, 'WORKER-DEFENSE', 'ORDER-WORKER-DEFENSE')`,
    );
    await pool.query(
      `insert into inventory_stock_jobs (
         order_id, company_id, external_order_id, order_number, status, source
       ) values
         (303, 4, 'WORKER-DEFENSE', 'ORDER-WORKER-DEFENSE', 'pending', 'canonical'),
         (null, 4, 'WORKER-DEFENSE', 'ORDER-WORKER-DEFENSE', 'pending', 'legacy')`,
    );
    const defended = [];
    const defendedRun = await processStockQueue({
      apply: async (input) => {
        defended.push(input.orderId);
        return { applied: 1, skipped: 0 };
      },
    }, pool);
    assert.equal(defendedRun.claimed, 1);
    assert.deepEqual(defended, [303]);
    const defendedReplay = await processStockQueue({ apply: async () => ({ applied: 99 }) }, pool);
    assert.equal(defendedReplay.claimed, 0);

    await pool.query('truncate inventory_stock_jobs restart identity');
    await pool.query(
      `insert into orders (id, company_id, external_order_id, external_order_number)
       values (302, 4, 'DONE-DUAL', 'ORDER-DONE-DUAL')`,
    );
    await pool.query(
      `insert into inventory_stock_jobs (
         order_id, company_id, external_order_id, order_number, status, source
       ) values
         (302, 4, 'DONE-DUAL', 'ORDER-DONE-DUAL', 'processing', 'canonical'),
         (null, 4, 'DONE-DUAL', 'ORDER-DONE-DUAL', 'done', 'legacy')`,
    );
    await ensureStockJobTables(pool);
    const doneDual = await queueRows(pool, 4, 'DONE-DUAL');
    assert.equal(doneDual.find((row) => row.order_id != null)?.status, 'done');
    const noRepeat = await processStockQueue({ apply: async () => ({ applied: 99 }) }, pool);
    assert.equal(noRepeat.claimed, 0);

    await pool.query('truncate inventory_stock_jobs restart identity');
    const owner = await pool.connect();
    let committed = false;
    try {
      await owner.query('begin');
      await owner.query(
        `insert into orders (id, company_id, external_order_id, external_order_number)
         values (401, 4, 'TX-RACE', 'ORDER-TX-RACE')`,
      );
      await enqueueStockJob({ orderId: 401, source: 'canonical-transaction' }, owner);
      let externalSettled = false;
      const external = enqueueStockJob({
        companyId: 4,
        externalOrderId: 'TX-RACE',
        source: 'external-race',
      }, pool).finally(() => { externalSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(externalSettled, false, 'el enqueue externo debe esperar el commit canónico');
      await owner.query('commit');
      committed = true;
      await external;
    } finally {
      if (!committed) await owner.query('rollback').catch(() => {});
      owner.release();
    }
    const raced = await queueRows(pool, 4, 'TX-RACE');
    assert.equal(raced.filter((row) => row.order_id != null).length, 1);
    assert.equal(
      raced.filter((row) => row.order_id == null && ['pending', 'processing', 'failed'].includes(row.status)).length,
      0,
    );

    await pool.query('truncate inventory_stock_jobs restart identity');
    const failingOwner = await pool.connect();
    try {
      await failingOwner.query('begin');
      await failingOwner.query(
        `insert into orders (id, company_id, external_order_id, external_order_number)
         values (402, 4, 'TX-ROLLBACK', 'ORDER-TX-ROLLBACK')`,
      );
      await failingOwner.query('drop table inventory_stock_jobs');
      await assert.rejects(
        enqueueStockJob({ orderId: 402, source: 'failing-transaction' }, failingOwner),
        /inventory_stock_jobs/,
      );
      const rollbackRace = enqueueStockJob({
        companyId: 4,
        externalOrderId: 'TX-ROLLBACK',
        source: 'external-after-rollback',
      }, pool);
      await failingOwner.query('rollback');
      const rollbackOutcome = await Promise.race([
        rollbackRace,
        new Promise((resolve) => setTimeout(() => resolve('timeout'), 500)),
      ]);
      assert.notEqual(rollbackOutcome, 'timeout', 'un error y rollback no deben filtrar el lock');
    } finally {
      await failingOwner.query('rollback').catch(() => {});
      failingOwner.release();
    }
    const afterRollback = await queueRows(pool, 4, 'TX-ROLLBACK');
    assert.equal(afterRollback.length, 1);
    assert.equal(afterRollback[0].order_id, null);
  } finally {
    await pool.end();
    await admin.query(`drop schema if exists ${schema} cascade`);
    await admin.end();
  }
});
