// Incrementally sync data from a SQLite boletas.db into Neon Postgres.
//
// This preserves newer rows already in Neon: existing rows are updated only
// when the SQLite row has a newer updated_at/created_at timestamp.
//
// Usage:
//   SQLITE_PATH="/path/to/boletas.db" node scripts/sync-sqlite-to-neon.mjs
//   DRY_RUN=1 SQLITE_PATH="/path/to/boletas.db" node scripts/sync-sqlite-to-neon.mjs
import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { Client } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQLITE_PATH = process.env.SQLITE_PATH ||
  join(__dirname, '..', 'packages', 'desktop', 'storage', 'boletas.db');
const PG_URL = process.env.DATABASE_URL_POSTGRES;
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

if (!PG_URL) {
  console.error('Missing DATABASE_URL_POSTGRES env var');
  process.exit(1);
}

const ORDER = [
  'companies',
  'branches',
  'users',
  'clients',
  'correlatives',
  'daily_summaries',
  'boletas',
  'facturas',
  'credit_notes',
];

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

function quoteIdent(name) {
  return '"' + String(name).replaceAll('"', '""') + '"';
}

function sqliteTables() {
  return new Set(
    sq.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name),
  );
}

function sourceTimestamp(row) {
  return Number(row.updated_at ?? row.created_at ?? 0);
}

async function pgColumns(table) {
  const { rows } = await pg.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table],
  );
  return rows.map((r) => r.column_name);
}

async function backupNeon(tables) {
  const backup = {
    createdAt: new Date().toISOString(),
    source: 'neon',
    tables: {},
  };

  for (const table of tables) {
    const { rows } = await pg.query(`SELECT * FROM ${quoteIdent(table)} ORDER BY id`);
    backup.tables[table] = rows;
  }

  const path = `/private/tmp/neon-boletas-backup-${Date.now()}.json`;
  writeFileSync(path, JSON.stringify(backup, null, 2));
  return path;
}

async function syncTable(table, sourceCols, targetCols) {
  const cols = sourceCols.filter((c) => targetCols.includes(c));
  if (!cols.includes('id')) {
    throw new Error(`${table}: no shared id column`);
  }

  const rows = sq.prepare(`SELECT ${cols.map(quoteIdent).join(', ')} FROM ${quoteIdent(table)}`).all();
  if (!rows.length) {
    return { table, source: 0, inserted: 0, updated: 0, skipped: 0 };
  }

  const boolSet = new Set(BOOL_COLS[table] || []);
  const existing = new Map();
  const ids = rows.map((r) => r.id);
  const CHUNK = 1000;

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { rows: pgRows } = await pg.query(
      `SELECT id, created_at, updated_at FROM ${quoteIdent(table)} WHERE id = ANY($1::int[])`,
      [chunk],
    );
    for (const row of pgRows) {
      existing.set(Number(row.id), Number(row.updated_at ?? row.created_at ?? 0));
    }
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const targetTs = existing.get(Number(row.id));
    if (targetTs === undefined) inserted += 1;
    else if (sourceTimestamp(row) > targetTs) updated += 1;
    else skipped += 1;
  }

  const updateCols = cols.filter((c) => c !== 'id');
  const assignments = updateCols
    .map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`)
    .join(', ');
  const insertCols = cols.map(quoteIdent).join(', ');
  const tableName = quoteIdent(table);
  const where =
    `COALESCE(EXCLUDED.updated_at, EXCLUDED.created_at, 0)::bigint > ` +
    `COALESCE(${tableName}.updated_at, ${tableName}.created_at, 0)::bigint`;

  const boolCols = new Set(BOOL_COLS[table] || []);
  const INSERT_CHUNK = 200;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    const params = [];
    const tuples = [];
    let p = 1;
    for (const row of chunk) {
      const placeholders = [];
      for (const c of cols) {
        let value = row[c];
        if (value !== null && value !== undefined && boolCols.has(c)) {
          value = !!value;
        }
        placeholders.push('$' + p++);
        params.push(value === undefined ? null : value);
      }
      tuples.push('(' + placeholders.join(', ') + ')');
    }

    const sql =
      `INSERT INTO ${tableName} (${insertCols}) VALUES ${tuples.join(', ')} ` +
      `ON CONFLICT (id) DO UPDATE SET ${assignments} WHERE ${where}`;
    await pg.query(sql, params);
  }

  await pg.query(
    `SELECT setval(pg_get_serial_sequence($1, 'id'),
            GREATEST(COALESCE((SELECT MAX(id) FROM ${tableName}), 1), 1), true)`,
    [table],
  );

  return { table, source: rows.length, inserted, updated, skipped };
}

try {
  const sqliteTableSet = sqliteTables();
  const presentTables = ORDER.filter((table) => sqliteTableSet.has(table));
  const missingTables = ORDER.filter((table) => !sqliteTableSet.has(table));
  const backupPath = await backupNeon(ORDER);

  await pg.query('BEGIN');
  const results = [];
  for (const table of presentTables) {
    const sourceCols = sq.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all().map((c) => c.name);
    const targetCols = await pgColumns(table);
    results.push(await syncTable(table, sourceCols, targetCols));
  }

  if (DRY_RUN) {
    await pg.query('ROLLBACK');
  } else {
    await pg.query('COMMIT');
  }

  console.log(JSON.stringify({
    dryRun: DRY_RUN,
    sqlitePath: SQLITE_PATH,
    backupPath,
    missingSourceTables: missingTables,
    results,
  }, null, 2));
} catch (err) {
  await pg.query('ROLLBACK').catch(() => {});
  console.error('Failed, rolled back:', err.message);
  process.exitCode = 1;
} finally {
  sq.close();
  await pg.end();
}
