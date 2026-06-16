// Migrate ALL data from the local SQLite db into Neon Postgres.
// Preserves primary-key ids and resets sequences. Idempotent (TRUNCATE first).
// PDFs/XML/CDR files are NOT touched — only the *_path references travel.
//
// Usage:
//   DATABASE_URL_POSTGRES="postgresql://..." node scripts/migrate-data-to-neon.mjs
//   (optional) SQLITE_PATH=packages/desktop/storage/boletas.db
import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQLITE_PATH = process.env.SQLITE_PATH ||
  join(__dirname, '..', 'packages', 'desktop', 'storage', 'boletas.db');
const PG_URL = process.env.DATABASE_URL_POSTGRES;

if (!PG_URL) {
  console.error('Missing DATABASE_URL_POSTGRES env var');
  process.exit(1);
}

// Insert order respects foreign keys.
const ORDER = [
  'companies', 'branches', 'users', 'clients', 'correlatives',
  'daily_summaries', 'boletas', 'facturas', 'credit_notes',
];

// SQLite stores these as INTEGER 0/1 -> Postgres BOOLEAN.
const BOOL_COLS = {
  companies: ['modo_produccion', 'activo'],
  branches: ['activo'],
  users: ['activo'],
  clients: ['activo'],
  correlatives: ['activo'],
};

const sq = new DatabaseSync(SQLITE_PATH, { readOnly: true });
const pg = new Client({ connectionString: PG_URL });
await pg.connect();

try {
  await pg.query('BEGIN');
  await pg.query(`TRUNCATE ${ORDER.join(', ')} RESTART IDENTITY CASCADE`);

  for (const table of ORDER) {
    const cols = sq.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    const rows = sq.prepare(`SELECT * FROM ${table}`).all();
    if (!rows.length) {
      console.log(`  ${table.padEnd(16)} 0 rows (skipped)`);
      continue;
    }
    const boolSet = new Set(BOOL_COLS[table] || []);

    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const params = [];
      const tuples = [];
      let p = 1;
      for (const r of chunk) {
        const placeholders = [];
        for (const c of cols) {
          let v = r[c];
          if (v !== null && v !== undefined && boolSet.has(c)) v = !!v;
          placeholders.push('$' + p++);
          params.push(v === undefined ? null : v);
        }
        tuples.push('(' + placeholders.join(',') + ')');
      }
      const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES ${tuples.join(', ')}`;
      await pg.query(sql, params);
    }

    // Keep the SERIAL sequence ahead of the migrated ids.
    await pg.query(
      `SELECT setval(pg_get_serial_sequence($1, 'id'),
              (SELECT MAX(id) FROM ${table}), true)`,
      [table]
    );
    console.log(`  ${table.padEnd(16)} ${rows.length} rows migrated`);
  }

  await pg.query('COMMIT');
  console.log('\nData migration committed.');

  // Verify counts on the Postgres side.
  console.log('\nPostgres row counts:');
  for (const table of ORDER) {
    const { rows } = await pg.query(`SELECT count(*)::int AS n FROM ${table}`);
    console.log(`  ${table.padEnd(16)} ${rows[0].n}`);
  }
} catch (err) {
  await pg.query('ROLLBACK').catch(() => {});
  console.error('Failed, rolled back:', err.message);
  process.exitCode = 1;
} finally {
  sq.close();
  await pg.end();
}
