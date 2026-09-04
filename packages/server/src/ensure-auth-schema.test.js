import assert from 'node:assert/strict';
import test from 'node:test';
import { LOCAL_CREDENTIAL_ISSUER } from './db-schema.js';
import { ensureAccountIssuerColumn, isIssuerBlocked } from './ensure-auth-schema.js';

function poolStub(replies) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      const text = String(sql);
      queries.push({ sql: text, params });
      const reply = replies.find((item) => item.match.test(text));
      return { rows: reply?.rows || [] };
    },
  };
}

test('isIssuerBlocked reconoce el bloqueo de Better Auth 1.7', () => {
  assert.equal(
    isIssuerBlocked(new Error('Cannot add required column "issuer" to populated table "account"')),
    true,
  );
  assert.equal(isIssuerBlocked(new Error('column users.role does not exist')), false);
});

test('ensureAccountIssuerColumn no toca nada si no existe account', async () => {
  const pool = poolStub([]);
  assert.deepEqual(await ensureAccountIssuerColumn(pool), { tableExisted: false });
  assert.equal(pool.queries.length, 1);
  assert.match(pool.queries[0].sql, /information_schema.tables/);
});

test('ensureAccountIssuerColumn agrega issuer y rellena cuentas credential', async () => {
  const pool = poolStub([
    { match: /information_schema/, rows: [{ exists: 1 }] },
  ]);
  assert.deepEqual(await ensureAccountIssuerColumn(pool), { tableExisted: true });
  assert.equal(pool.queries.length, 3);
  assert.match(pool.queries[1].sql, /ADD COLUMN IF NOT EXISTS issuer TEXT/);
  assert.match(pool.queries[2].sql, /SET issuer = \$1/);
  assert.match(pool.queries[2].sql, /"providerId" = 'credential'/);
  assert.deepEqual(pool.queries[2].params, [LOCAL_CREDENTIAL_ISSUER]);
});
