import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../../.env') });
process.env.AUTH_ALLOW_SIGNUP = 'true'; // permitir el alta solo para este seed

const { auth } = await import('./auth.js');
const users = await import('./users.js');
await users.ensureUserColumns();

const email = String(process.env.ADMIN_EMAIL || '').trim();
const password = String(process.env.ADMIN_PASSWORD || '');
if (!email || !password) {
  throw new Error('ADMIN_EMAIL y ADMIN_PASSWORD son obligatorios para crear el superadministrador');
}
try {
  const res = await auth.api.signUpEmail({ body: { email, password, name: 'Admin' } });
  console.log('Admin creado:', email, '(id:', res?.user?.id, ')');
} catch (e) {
  console.log('No se creó (¿ya existe?):', String(e && e.message || e).slice(0, 120));
}

// Asegurar rol superadmin al usuario seed sin credenciales por defecto.
try {
  await users.promoteSuperadminByEmail(email);
  console.log('Rol superadmin aplicado a', email);
} catch (e) {
  console.log('No se pudo marcar superadmin:', String(e && e.message || e).slice(0, 120));
}
process.exit(0);
