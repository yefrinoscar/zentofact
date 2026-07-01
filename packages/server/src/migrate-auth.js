import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../../.env') });

const { getMigrations } = await import('better-auth/db/migration');
const { auth } = await import('./auth.js');

const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);
console.log('Tablas a crear:', toBeCreated.map((t) => t.table || t.name || Object.keys(t)[0]));
if (toBeAdded?.length) console.log('Columnas a agregar:', toBeAdded.map((t) => t.table));
await runMigrations();
console.log('Migración de auth aplicada ✅');
process.exit(0);
