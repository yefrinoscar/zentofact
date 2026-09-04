import { Pool } from 'pg';
import { LOCAL_CREDENTIAL_ISSUER } from './db-schema.js';

function migrationErrorMessage(error) {
  return String(error?.message || error || '');
}

export function isIssuerBlocked(error) {
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

/** Better Auth 1.6 never creates issuer; 1.7 refuses to add it as NOT NULL on a populated table. */
export async function ensureAccountIssuerColumn(pool) {
  const { rows } = await pool.query(`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'account'
    LIMIT 1
  `);
  if (!rows.length) return { tableExisted: false };
  await pool.query('ALTER TABLE account ADD COLUMN IF NOT EXISTS issuer TEXT');
  await pool.query(
    `UPDATE account
        SET issuer = $1
      WHERE "providerId" = 'credential'
        AND (issuer IS NULL OR issuer = '')`,
    [LOCAL_CREDENTIAL_ISSUER],
  );
  return { tableExisted: true };
}

async function softenIssuerIfAccountExists() {
  await withAuthPool(ensureAccountIssuerColumn);
}

export async function ensureAuthSchema() {
  await softenIssuerIfAccountExists();

  const { getMigrations } = await import('better-auth/db/migration');
  const { auth } = await import('./auth.js');

  let migrations;
  try {
    migrations = await getMigrations(auth.options);
  } catch (error) {
    if (!isIssuerBlocked(error)) throw error;
    console.warn('[AUTH] Migración de issuer bloqueada; creando columna nullable y reintentando.');
    await withAuthPool(ensureAccountIssuerColumn);
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
    await withAuthPool(ensureAccountIssuerColumn);
    const retry = await getMigrations(auth.options);
    await retry.runMigrations();
  }

  if (unsafeChanges?.length) {
    console.warn('[AUTH] Cambios de schema pendientes (no bloqueantes):', unsafeChanges.length);
  }
}
