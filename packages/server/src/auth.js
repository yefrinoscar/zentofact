// Módulo de autenticación desacoplado (Better Auth).
// Aislado del resto del server: aquí se configura, en index.js solo se monta y se usa el guard.
import { betterAuth } from 'better-auth';
import { createHmac, timingSafeEqual } from 'crypto';
import { Pool } from 'pg';
import { isAdminRole, userHasPermission } from './permissions.js';
import { isProtectedPath } from './protected-paths.js';
import { isLocalDevelopmentOrigin, localAuthOriginPatterns, localWebOrigins } from './local-web-origins.js';

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
  ...localWebOrigins(),
  ...localAuthOriginPatterns(),
].filter(Boolean)));
const trustedOriginSet = new Set([
  ...trustedOrigins,
  (() => { try { return new URL(baseURL).origin; } catch { return ''; } })(),
].filter(Boolean));
const authSecret = process.env.BETTER_AUTH_SECRET || 'dev-secret-change-me';
if (process.env.NODE_ENV === 'production' && !process.env.BETTER_AUTH_SECRET) {
  throw new Error('BETTER_AUTH_SECRET es obligatorio en producción');
}

const RESEND_API_KEY = String(process.env.RESEND_API_KEY || '').trim();
// Sin dominio verificado: usar sandbox de Resend (solo envía al email de la cuenta Resend).
const RESEND_FROM_EMAIL = String(process.env.RESEND_FROM_EMAIL || 'ZentoFact <onboarding@resend.dev>').trim();
const PASSWORD_MIN_LENGTH = 12;

async function sendPasswordResetEmail({ to, resetUrl, userName }) {
  const subject = 'Restablecer contraseña · ZentoFact';
  const safeName = String(userName || '').trim() || 'hola';
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
      <p style="font-size:16px;margin:0 0 12px">Hola ${safeName},</p>
      <p style="font-size:14px;line-height:1.5;margin:0 0 20px;color:#444">
        Recibimos una solicitud para restablecer tu contraseña de ZentoFact.
        El enlace expira en 1 hora.
      </p>
      <p style="margin:0 0 24px">
        <a href="${resetUrl}"
           style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-size:14px;font-weight:600">
          Elegir nueva contraseña
        </a>
      </p>
      <p style="font-size:12px;line-height:1.5;color:#777;margin:0 0 8px">
        Si el botón no funciona, copia y pega este enlace en tu navegador:
      </p>
      <p style="font-size:12px;word-break:break-all;color:#555;margin:0 0 20px">${resetUrl}</p>
      <p style="font-size:12px;color:#999;margin:0">Si no pediste este cambio, ignora este correo.</p>
    </div>
  `.trim();

  if (!RESEND_API_KEY) {
    console.warn('[AUTH] RESEND_API_KEY no configurado. Link de reset (solo logs):');
    console.warn(`[AUTH] to=${to}`);
    console.warn(`[AUTH] url=${resetUrl}`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: [to],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[AUTH] Resend error', res.status, body);
    throw new Error('No se pudo enviar el correo de restablecimiento');
  }
}

export const auth = betterAuth({
  database: pool,
  baseURL,
  secret: authSecret,
  emailAndPassword: {
    enabled: true,
    // Registro público deshabilitado: los usuarios se crean desde /users (admin).
    disableSignUp: process.env.AUTH_ALLOW_SIGNUP !== 'true',
    minPasswordLength: PASSWORD_MIN_LENGTH,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await sendPasswordResetEmail({
        to: user.email,
        resetUrl: url,
        userName: user.name,
      });
    },
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
  const normalized = String(origin || '').replace(/\/$/, '');
  return trustedOriginSet.has(normalized) || isLocalDevelopmentOrigin(normalized);
}

export function originMatchesRequestHost(origin, hostHeader, forwardedHost) {
  const normalized = String(origin || '').replace(/\/$/, '');
  if (!normalized) return false;
  let originHost = '';
  try { originHost = new URL(normalized).host; } catch { return false; }
  const hosts = [hostHeader, forwardedHost]
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  return hosts.some((host) => host === originHost);
}

function requestOrigin(c) {
  const origin = String(c.req.header('origin') || '').replace(/\/$/, '');
  if (origin) return origin;
  const referer = c.req.header('referer');
  if (!referer) return '';
  try { return new URL(referer).origin; } catch { return ''; }
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
    const origin = requestOrigin(c);
    const token = c.req.header('x-csrf-token');
    const expected = csrfTokenForSession(c.get('session'));
    const originOk = isTrustedOrigin(origin)
      || originMatchesRequestHost(origin, c.req.header('host'), c.req.header('x-forwarded-host'));
    if (!originOk || !token || !expected) {
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

export function requirePermission(permissionKey, options = {}) {
  return requireAnyPermission([permissionKey], options);
}

export function requireAnyPermission(permissionKeys, options = {}) {
  if (!Array.isArray(permissionKeys) || permissionKeys.length === 0) {
    throw new TypeError('requireAnyPermission exige al menos un permiso');
  }
  return async (c, next) => {
    const user = c.get('user');
    if (!permissionKeys.some((permissionKey) => userHasPermission(user, permissionKey))) {
      return c.json({ error: 'Sin permiso' }, 403);
    }
    if (!options.readOnly && String(user?.role || '') === 'viewer' && UNSAFE_METHODS.has(c.req.method)) {
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
