// Barrido SUNAT del servidor contra PostgreSQL real (base DESECHABLE: corre
// las migraciones de core y las tablas de auto-emisión).
//   AUTO_EMISSION_TEST_DATABASE_URL=postgres://... node --test src/sunat-sweep.integration.test.js
import assert from 'node:assert/strict';
import test from 'node:test';

const connectionString = process.env.AUTO_EMISSION_TEST_DATABASE_URL;

test('barrido SUNAT: recupera envíos colgados, reencola jobs fallidos y avisa una sola vez', {
  skip: !connectionString && 'define AUTO_EMISSION_TEST_DATABASE_URL para ejecutar la integración',
}, async () => {
  process.env.DATABASE_URL_POSTGRES = connectionString;
  process.env.SUNAT_FORCE_ENV = 'beta';
  process.env.AUTO_EMIT_ALERT_EMAIL = 'operaciones@zentofact.test';
  process.env.RESEND_API_KEY = '';

  const core = await import('@zentofact/core');
  await core.runMigrations(core.pool);
  const autoEmit = await import('./auto-emission.js');
  await autoEmit.ensureTables();
  const { pool } = core;

  const ruc = `20${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  const company = (await pool.query(`insert into companies (ruc, razon_social) values ($1, 'SWEEP SAC') returning id`, [ruc])).rows[0];
  const branch = (await pool.query(`insert into branches (company_id, codigo, nombre) values ($1, '0000', 'PRINCIPAL') returning id`, [company.id])).rows[0];
  const client = (await pool.query(`insert into clients (company_id, tipo_documento, numero_documento, razon_social) values ($1, '1', '45678912', 'CLIENTE') returning id`, [company.id])).rows[0];
  await autoEmit.setCompanyEnabled(company.id, true);

  const now = Math.floor(Date.now() / 1000);
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000 - 6 * 3600000).toISOString().slice(0, 10);
  const insertBoleta = async ({ correlativo, estado, order, updatedAt }) => (await pool.query(
    `insert into boletas (company_id, branch_id, client_id, serie, correlativo, numero_completo, fecha_emision, detalles, estado_sunat, order_number, updated_at)
     values ($1, $2, $3, 'B001', $4, $5, $6, '[]'::jsonb, $7, $8, $9) returning id`,
    [company.id, branch.id, client.id, correlativo, `B001-${correlativo}`, twoDaysAgo, estado, order, updatedAt],
  )).rows[0].id;

  const crashedId = await insertBoleta({ correlativo: '000001', estado: 'ENVIANDO', order: 'ORD-CRASH', updatedAt: now - 3600 });
  const unconfirmedId = await insertBoleta({ correlativo: '000002', estado: 'NO_CONFIRMADO', order: 'ORD-FAILED', updatedAt: now - 3600 });
  const failedJob = (await pool.query(
    `insert into emission_jobs (company_id, order_number, kind, status, attempts, last_error) values ($1, 'ORD-FAILED', 'invoice', 'failed', 6, 'timeout') returning id`,
    [company.id],
  )).rows[0];
  const processingJob = (await pool.query(
    `insert into emission_jobs (company_id, order_number, kind, status, attempts) values ($1, 'ORD-CRASH', 'invoice', 'processing', 1) returning id`,
    [company.id],
  )).rows[0];

  try {
    const first = await autoEmit.sweepSunatDocuments();
    assert.ok(first.recovered >= 1);
    assert.equal((await pool.query('select estado_sunat from boletas where id=$1', [crashedId])).rows[0].estado_sunat, 'NO_CONFIRMADO');

    const job = (await pool.query('select status, attempts from emission_jobs where id=$1', [failedJob.id])).rows[0];
    assert.deepEqual(job, { status: 'pending', attempts: 0 }, 'el job fallido vuelve a la cola para reconciliar');
    assert.equal((await pool.query('select status from emission_jobs where id=$1', [processingJob.id])).rows[0].status, 'processing', 'un job activo no se toca');

    const alerts = (await pool.query(
      `select document_id from sunat_document_alerts where document_table='boletas' and document_id = any($1::int[]) order by document_id`,
      [[crashedId, unconfirmedId]],
    )).rows.map((row) => row.document_id);
    assert.deepEqual(alerts, [crashedId, unconfirmedId], 'se avisa de lo que sigue sin aceptación cerca del plazo');

    const second = await autoEmit.sweepSunatDocuments();
    assert.equal(second.alerted, 0, 'el aviso de cada comprobante se envía una sola vez');
  } finally {
    await pool.query('delete from emission_jobs where company_id=$1', [company.id]);
    await pool.end();
  }
});
