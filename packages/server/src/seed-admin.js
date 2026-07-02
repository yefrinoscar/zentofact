import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../../.env') });
process.env.AUTH_ALLOW_SIGNUP = 'true'; // permitir el alta solo para este seed

const { auth } = await import('./auth.js');
const email = process.env.ADMIN_EMAIL || 'admin@zentofact.com';
const password = process.env.ADMIN_PASSWORD || 'ZentoFact2026!';
try {
  const res = await auth.api.signUpEmail({ body: { email, password, name: 'Admin' } });
  console.log('Admin creado:', email, '(id:', res?.user?.id, ')');
} catch (e) {
  console.log('No se creó (¿ya existe?):', String(e && e.message || e).slice(0, 120));
}
process.exit(0);
