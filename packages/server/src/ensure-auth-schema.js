// Aplica el DDL de Better Auth antes de tocar columnas custom de "user".
// Necesario en PR previews de Railway, donde Postgres nace vacío.
import { getMigrations } from 'better-auth/db/migration';
import { Pool } from 'pg';
import { auth } from './auth.js';

function migrationErrorMessage(error) {
  return String(error?.message || error || '');
}

async function ensureIssuerColumnNullable(pool) {
  await pool.query('ALTER TABLE account ADD COLUMN IF NOT EXISTS issuer TEXT');
}

export async function ensureAuthSchema() {
  const { toBeCreated, toBeAdded, unsafeChanges, runMigrations } = await getMigrations(auth.options);
  if (toBeCreated?.length) {
    console.log('[AUTH] Tablas a crear:', toBeCreated.map((table) => table.table || table.name || Object.keys(table)[0]));
  }
  if (toBeAdded?.length) {
    console.log('[AUTH] Columnas a agregar:', toBeAdded.map((table) => table.table));
  }

  try {
    await runMigrations();
  } catch (error) {
    const message = migrationErrorMessage(error);
    const issuerBlocked = message.includes('issuer') && message.includes('account');
    if (!issuerBlocked) throw error;

    // Better Auth 1.7 puede exigir issuer NOT NULL sobre filas existentes.
    // En previews/DB viejas: crear nullable, reintentar, y seguir.
    console.warn('[AUTH] Migración de issuer bloqueada; creando columna nullable y reintentando.');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL_POSTGRES });
    try {
      await ensureIssuerColumnNullable(pool);
    } finally {
      await pool.end();
    }
    const retry = await getMigrations(auth.options);
    await retry.runMigrations();
  }

  if (unsafeChanges?.length) {
    console.warn('[AUTH] Cambios de schema pendientes (no bloqueantes):', unsafeChanges.length);
  }
}
