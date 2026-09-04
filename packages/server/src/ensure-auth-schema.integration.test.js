import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { LOCAL_CREDENTIAL_ISSUER } from './db-schema.js';
import { ensureAccountIssuerColumn } from './ensure-auth-schema.js';

const connectionString = process.env.DATABASE_URL_POSTGRES;

test('PostgreSQL real: createUser puede insertar issuer en una account 1.6 poblada', {
  skip: !connectionString && 'define DATABASE_URL_POSTGRES para ejecutar la integración',
}, async () => {
  const dbName = `issuer_fix_${process.pid}_${Date.now()}`;
  const admin = new Pool({ connectionString, max: 1 });
  await admin.query(`CREATE DATABASE ${dbName}`);
  const isolated = new Pool({
    connectionString: connectionString.replace(/\/[^/]+$/, `/${dbName}`),
    max: 1,
  });
  try {
    await isolated.query(`
      CREATE TABLE account (
        id TEXT PRIMARY KEY,
        "accountId" TEXT NOT NULL,
        "providerId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        password TEXT,
        "createdAt" TIMESTAMPTZ,
        "updatedAt" TIMESTAMPTZ
      )
    `);
    await isolated.query(`
      INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
      VALUES ('acc-1', 'user-1', 'credential', 'user-1', 'hash', NOW(), NOW())
    `);

    await assert.rejects(
      isolated.query(`
        INSERT INTO account (id, "accountId", "providerId", "userId", issuer, password, "createdAt", "updatedAt")
        VALUES ('acc-2', 'user-2', 'credential', 'user-2', $1, 'hash', NOW(), NOW())
      `, [LOCAL_CREDENTIAL_ISSUER]),
      /issuer/,
    );

    const result = await ensureAccountIssuerColumn(isolated);
    assert.deepEqual(result, { tableExisted: true });

    const columns = await isolated.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'account' AND column_name = 'issuer'
    `);
    assert.equal(columns.rows.length, 1);

    const backfill = await isolated.query(`SELECT issuer FROM account WHERE id = 'acc-1'`);
    assert.equal(backfill.rows[0].issuer, LOCAL_CREDENTIAL_ISSUER);

    await isolated.query(`
      INSERT INTO account (id, "accountId", "providerId", "userId", issuer, password, "createdAt", "updatedAt")
      VALUES ('acc-2', 'user-2', 'credential', 'user-2', $1, 'hash', NOW(), NOW())
    `, [LOCAL_CREDENTIAL_ISSUER]);
    const created = await isolated.query(`SELECT issuer FROM account WHERE id = 'acc-2'`);
    assert.equal(created.rows[0].issuer, LOCAL_CREDENTIAL_ISSUER);
  } finally {
    await isolated.end();
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  }
});
