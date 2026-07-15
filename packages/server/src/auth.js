// Módulo de autenticación desacoplado (Better Auth).
// Aislado del resto del server: aquí se configura, en index.js solo se monta y se usa el guard.
import { betterAuth } from 'better-auth';
import { createHmac, timingSafeEqual } from 'crypto';
import { Pool } from 'pg';
import { isAdminRole, userHasPermission } from './permissions.js';
import { isProtectedPath } from './protected-paths.js';

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
const trustedOriginSet = new Set([
  ...trustedOrigins,
  (() => { try { return new URL(baseURL).origin; } catch { return ''; } })(),
].filter(Boolean));
const authSecret = process.env.BETTER_AUTH_SECRET || 'dev-secret-change-me';
if (process.env.NODE_ENV === 'production' && !process.env.BETTER_AUTH_SECRET) {
  throw new Error('BETTER_AUTH_SECRET es obligatorio en producción');
}

export const auth = betterAuth({
  database: pool,
  baseURL,
  secret: authSecret,
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
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isTrustedOrigin(origin) {
  return trustedOriginSet.has(String(origin || '').replace(/\/$/, ''));
}

export function csrfTokenForSession(session) {
  const sessionId = session?.id || session?.token;
  if (!sessionId) return null;
  return createHmac('sha256', authSecret).update(`csrf:${sessionId}`).digest('base64url');
}

// Guard: exige sesión solo en rutas protegidas del API.
export function requireAuth() {
  return async (c, next) => {
    const path = c.req.path;
    const needsAuth = isProtectedPath(path);
    if (!needsAuth) return next();
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'No autenticado' }, 401);

    // Recargar autorización desde PostgreSQL para que roles y desactivaciones
    // se apliquen aunque la cookie de sesión sea anterior al cambio.
    const { rows } = await pool.query(
      `SELECT role, permissions, active FROM "user" WHERE id = $1 LIMIT 1`,
      [session.user?.id],
    );
    const currentUser = rows[0];
    if (!currentUser || currentUser.active === false) {
      return c.json({ error: 'Usuario desactivado' }, 403);
    }

    c.set('user', { ...session.user, ...currentUser });
    c.set('session', session.session);
    return next();
  };
}

// Las rutas personalizadas usan cookies de sesión; CORS no evita que una web
// externa envíe un POST. Requerimos origen conocido y token ligado a sesión.
export function requireCsrf() {
  return async (c, next) => {
    const path = c.req.path;
    const needsAuth = isProtectedPath(path);
    if (!needsAuth || !UNSAFE_METHODS.has(c.req.method)) return next();
    const origin = c.req.header('origin');
    const token = c.req.header('x-csrf-token');
    const expected = csrfTokenForSession(c.get('session'));
    if (!origin || !isTrustedOrigin(origin) || !token || !expected) {
      return c.json({ error: 'CSRF inválido' }, 403);
    }
    const received = Buffer.from(token);
    const expectedBuffer = Buffer.from(expected);
    if (received.length !== expectedBuffer.length || !timingSafeEqual(received, expectedBuffer)) {
      return c.json({ error: 'CSRF inválido' }, 403);
    }
    return next();
  };
}

export function requirePermission(permissionKey) {
  return async (c, next) => {
    const user = c.get('user');
    if (!userHasPermission(user, permissionKey)) {
      return c.json({ error: 'Sin permiso' }, 403);
    }
    if (String(user?.role || '') === 'viewer' && UNSAFE_METHODS.has(c.req.method)) {
      return c.json({ error: 'Perfil de solo lectura' }, 403);
    }
    return next();
  };
}

export function requireAdmin() {
  return async (c, next) => {
    if (!isAdminRole(c.get('user')?.role)) return c.json({ error: 'Se requiere administrador' }, 403);
    return next();
  };
}
