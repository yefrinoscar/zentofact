import { getMigrations } from 'better-auth/db/migration';
import { Pool } from 'pg';
import { auth } from './auth.js';

function migrationErrorMessage(error) {
  return String(error?.message || error || '');
}

function isIssuerBlocked(error) {
  const message = migrationErrorMessage(error);
  return message.includes('issuer') && message.includes('account');
}

async function withAuthPool(fn) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_POSTGRES });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

async function ensureIssuerColumnNullable(pool) {
  await pool.query('ALTER TABLE account ADD COLUMN IF NOT EXISTS issuer TEXT');
  await pool.query(`
    UPDATE account
       SET issuer = 'local:credential'
     WHERE "providerId" = 'credential'
       AND (issuer IS NULL OR issuer = '')
  `);
}

async function softenIssuerIfAccountExists() {
  await withAuthPool(async (pool) => {
    const { rows } = await pool.query(`
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'account'
      LIMIT 1
    `);
    if (!rows.length) return;
    await ensureIssuerColumnNullable(pool);
  });
}

export async function ensureAuthSchema() {
  await softenIssuerIfAccountExists();

  let migrations;
  try {
    migrations = await getMigrations(auth.options);
  } catch (error) {
    if (!isIssuerBlocked(error)) throw error;
    console.warn('[AUTH] Migración de issuer bloqueada; creando columna nullable y reintentando.');
    await withAuthPool(ensureIssuerColumnNullable);
    migrations = await getMigrations(auth.options);
  }

  const { toBeCreated, toBeAdded, unsafeChanges, runMigrations } = migrations;
  if (toBeCreated?.length) {
    console.log('[AUTH] Tablas a crear:', toBeCreated.map((table) => table.table || table.name || Object.keys(table)[0]));
  }
  if (toBeAdded?.length) {
    console.log('[AUTH] Columnas a agregar:', toBeAdded.map((table) => table.table));
  }

  try {
    await runMigrations();
  } catch (error) {
    if (!isIssuerBlocked(error)) throw error;
    console.warn('[AUTH] Migración de issuer bloqueada; creando columna nullable y reintentando.');
    await withAuthPool(ensureIssuerColumnNullable);
    const retry = await getMigrations(auth.options);
    await retry.runMigrations();
  }

  if (unsafeChanges?.length) {
    console.warn('[AUTH] Cambios de schema pendientes (no bloqueantes):', unsafeChanges.length);
  }
}
