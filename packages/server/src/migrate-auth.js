import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../../.env') });

const { ensureAuthSchema } = await import('./ensure-auth-schema.js');
await ensureAuthSchema();
console.log('Migración de auth aplicada ✅');
process.exit(0);
