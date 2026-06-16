// Push the Postgres structure (no data) to Neon.
// Usage: DATABASE_URL_POSTGRES="postgresql://..." node scripts/push-schema-neon.mjs
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, '..', 'packages', 'core', 'src', 'db', 'schema.postgres.sql');

const connectionString = process.env.DATABASE_URL_POSTGRES;
if (!connectionString) {
  console.error('Missing DATABASE_URL_POSTGRES env var');
  process.exit(1);
}

const sql = readFileSync(sqlPath, 'utf8');

const client = new Client({ connectionString });

try {
  await client.connect();
  console.log('Connected to Neon. Applying structure...');
  await client.query(sql);

  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name`
  );
  console.log('\nTables now in database:');
  for (const r of rows) console.log('  -', r.table_name);
  console.log('\nDone. Structure only, no data inserted.');
} catch (err) {
  console.error('Failed:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
