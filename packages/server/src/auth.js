// Módulo de autenticación desacoplado (Better Auth).
// Aislado del resto del server: aquí se configura, en index.js solo se monta y se usa el guard.
import { betterAuth } from 'better-auth';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL_POSTGRES });
const railwayOrigin = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '';
const trustedOrigins = Array.from(new Set([
  ...(process.env.WEB_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  railwayOrigin,
  'http://localhost:3011',
  'http://127.0.0.1:3011',
  'http://localhost:3000',
].filter(Boolean)));

export const auth = betterAuth({
  database: pool,
  baseURL: process.env.AUTH_BASE_URL || railwayOrigin || `http://localhost:${process.env.PORT || 3010}`,
  secret: process.env.BETTER_AUTH_SECRET || 'dev-secret-change-me',
  emailAndPassword: {
    enabled: true,
    // Registro deshabilitado por defecto: los usuarios se crean desde el server (admin/seed),
    // no cualquiera se registra. Se puede habilitar si se quiere autoservicio.
    disableSignUp: process.env.AUTH_ALLOW_SIGNUP !== 'true',
  },
  trustedOrigins,
});

// Prefijos del API que exigen sesión. Todo lo demás (login, estáticos del front) es público.
const PROTECTED = ['/companies', '/branches', '/boletas', '/facturas', '/credit-notes', '/daily-summaries', '/falabella', '/workflow'];

// Guard: exige sesión solo en rutas protegidas del API.
export function requireAuth() {
  return async (c, next) => {
    const path = c.req.path;
    const needsAuth = PROTECTED.some((p) => path === p || path.startsWith(p + '/') || path.startsWith(p + '?'));
    if (!needsAuth) return next();
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'No autenticado' }, 401);
    c.set('user', session.user);
    c.set('session', session.session);
    return next();
  };
}
