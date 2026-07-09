import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../../.env') });
process.env.AUTH_ALLOW_SIGNUP = 'true'; // permitir el alta solo para este seed

const { auth } = await import('./auth.js');
const users = await import('./users.js');
await users.ensureUserColumns();

const email = process.env.ADMIN_EMAIL || 'admin@zentofact.com';
const password = process.env.ADMIN_PASSWORD || 'ZentoFact2026!';
try {
  const res = await auth.api.signUpEmail({ body: { email, password, name: 'Admin' } });
  console.log('Admin creado:', email, '(id:', res?.user?.id, ')');
} catch (e) {
  console.log('No se creó (¿ya existe?):', String(e && e.message || e).slice(0, 120));
}

// Asegurar rol admin al usuario seed
try {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_POSTGRES });
  const { ALL_PERMISSION_KEYS } = await import('./permissions.js');
  await pool.query(
    `UPDATE "user" SET role = 'admin', permissions = $2, active = true
     WHERE lower(email) = lower($1)`,
    [email, JSON.stringify(ALL_PERMISSION_KEYS)],
  );
  console.log('Rol admin aplicado a', email);
  await pool.end();
} catch (e) {
  console.log('No se pudo marcar admin:', String(e && e.message || e).slice(0, 120));
}
process.exit(0);
