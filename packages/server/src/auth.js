// Módulo de autenticación desacoplado (Better Auth).
// Aislado del resto del server: aquí se configura, en index.js solo se monta y se usa el guard.
import { betterAuth } from 'better-auth';
import { Pool } from 'pg';
import { userHasPermission } from './permissions.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL_POSTGRES });
const railwayOrigin = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '';
const baseURL = process.env.AUTH_BASE_URL || railwayOrigin || `http://localhost:${process.env.PORT || 3010}`;
const usesHttps = baseURL.startsWith('https://');
const trustedOrigins = Array.from(new Set([
  ...(process.env.WEB_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  railwayOrigin,
  'http://localhost:3011',
  'http://127.0.0.1:3011',
  'http://localhost:3000',
].filter(Boolean)));

export const auth = betterAuth({
  database: pool,
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET || 'dev-secret-change-me',
  emailAndPassword: {
    enabled: true,
    // Registro público deshabilitado: los usuarios se crean desde /users (admin).
    disableSignUp: process.env.AUTH_ALLOW_SIGNUP !== 'true',
  },
  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: false,
        defaultValue: 'operator',
        input: false,
      },
      permissions: {
        type: 'string',
        required: false,
        defaultValue: '[]',
        input: false,
      },
      active: {
        type: 'boolean',
        required: false,
        defaultValue: true,
        input: false,
      },
    },
  },
  databaseHooks: {
    session: {
      create: {
        async before(session) {
          const { rows } = await pool.query(
            `SELECT active FROM "user" WHERE id = $1 LIMIT 1`,
            [session.userId],
          );
          if (rows[0] && rows[0].active === false) {
            throw new Error('Usuario desactivado');
          }
          return { data: session };
        },
      },
    },
  },
  advanced: {
    defaultCookieAttributes: usesHttps
      ? { sameSite: 'none', secure: true }
      : { sameSite: 'lax', secure: false },
  },
  trustedOrigins,
});

// Prefijos del API que exigen sesión. Todo lo demás (login, estáticos del front) es público.
const PROTECTED = [
  '/companies',
  '/branches',
  '/boletas',
  '/facturas',
  '/credit-notes',
  '/falabella',
  '/workflow',
  '/auto-emit',
  '/users',
  '/me',
];

// Guard: exige sesión solo en rutas protegidas del API.
export function requireAuth() {
  return async (c, next) => {
    const path = c.req.path;
    const needsAuth = PROTECTED.some((p) => path === p || path.startsWith(p + '/') || path.startsWith(p + '?'));
    if (!needsAuth) return next();
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'No autenticado' }, 401);

    // Usuario desactivado no puede usar el API.
    if (session.user?.active === false) {
      return c.json({ error: 'Usuario desactivado' }, 403);
    }

    c.set('user', session.user);
    c.set('session', session.session);
    return next();
  };
}

export function requirePermission(permissionKey) {
  return async (c, next) => {
    const user = c.get('user');
    if (!userHasPermission(user, permissionKey)) {
      return c.json({ error: 'Sin permiso' }, 403);
    }
    return next();
  };
}
