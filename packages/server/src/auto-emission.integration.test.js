import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';

const connectionString = process.env.AUTO_EMISSION_TEST_DATABASE_URL;

test('PostgreSQL real: detecta comprobante aceptado sin UNION inválido', {
  skip: !connectionString && 'define AUTO_EMISSION_TEST_DATABASE_URL para ejecutar la integración',
}, async () => {
  process.env.DATABASE_URL_POSTGRES ||= connectionString;
  const { hasAcceptedSalesDocument } = await import('./auto-emission.js');
  const schema = `auto_emission_test_${process.pid}_${Date.now()}`;
  const admin = new Pool({ connectionString, max: 1 });
  await admin.query(`create schema ${schema}`);
  const pool = new Pool({ connectionString, max: 1, options: `-c search_path=${schema}` });
  try {
    await pool.query(`
      create table boletas (
        company_id integer not null,
        order_number text not null,
        estado_sunat text
      );
      create table facturas (
        company_id integer not null,
        order_number text not null,
        estado_sunat text
      )
    `);
    assert.equal(await hasAcceptedSalesDocument(4, '3248821186', pool), false);
    await pool.query(
      `insert into boletas (company_id, order_number, estado_sunat)
       values (4, '3248821186', 'ACEPTADO')`,
    );
    assert.equal(await hasAcceptedSalesDocument(4, '3248821186', pool), true);
    await pool.query('truncate boletas');
    await pool.query(
      `insert into facturas (company_id, order_number, estado_sunat)
       values (4, '3248821186', 'ACEPTADO')`,
    );
    assert.equal(await hasAcceptedSalesDocument(4, '3248821186', pool), true);
  } finally {
    await pool.end();
    await admin.query(`drop schema if exists ${schema} cascade`);
    await admin.end();
  }
});
