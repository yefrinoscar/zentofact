import { localAuthOriginPatterns, localWebOrigins } from './local-web-origins.js';

// Public LIMBO origins. Production login rejects callbackURL until these are trusted.
// The live custom domain is zentoolabs.com; keep zentolabs.com as a documented alias.
export const CANONICAL_WEB_ORIGINS = [
  'https://limbo.zentoolabs.com',
  'https://limbo.zentolabs.com',
];

export const CANONICAL_AUTH_ORIGIN_PATTERNS = [
  'https://*.zentoolabs.com',
  'https://*.zentolabs.com',
];

const TRUSTED_APEX_HOSTS = [
  'zentoolabs.com',
  'zentolabs.com',
];

function originFromUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(candidate).origin;
  } catch {
    return '';
  }
}

export function isZentolabsOrigin(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:'
      && TRUSTED_APEX_HOSTS.some((apex) => url.hostname === apex || url.hostname.endsWith(`.${apex}`));
  } catch {
    return false;
  }
}

export function railwayServiceOrigins(env = process.env) {
  const origins = [];
  const publicDomain = String(env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  if (publicDomain) origins.push(originFromUrl(publicDomain) || `https://${publicDomain}`);
  for (const key of ['RAILWAY_SERVICE_ZENTOFACT_WEB_URL', 'RAILWAY_STATIC_URL']) {
    const origin = originFromUrl(env[key]);
    if (origin) origins.push(origin);
  }
  return [...new Set(origins.filter(Boolean))];
}

export function configuredWebOrigins(env = process.env) {
  return String(env.WEB_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function resolveWebOrigins({
  env = process.env,
  includeAuthPatterns = false,
  localOrigins = localWebOrigins({ nodeEnv: env.NODE_ENV }),
  localPatterns = includeAuthPatterns ? localAuthOriginPatterns({ nodeEnv: env.NODE_ENV }) : [],
} = {}) {
  return Array.from(new Set([
    ...configuredWebOrigins(env),
    ...railwayServiceOrigins(env),
    ...CANONICAL_WEB_ORIGINS,
    ...(includeAuthPatterns ? CANONICAL_AUTH_ORIGIN_PATTERNS : []),
    'http://localhost:3011',
    'http://127.0.0.1:3011',
    'http://localhost:3000',
    ...localOrigins,
    ...localPatterns,
  ].filter(Boolean)));
}

export function allowCorsOrigin(origin, webOrigins = resolveWebOrigins()) {
  const normalized = String(origin || '').replace(/\/$/, '');
  if (!normalized) return null;
  if (webOrigins.includes(normalized) || isZentolabsOrigin(normalized)) return normalized;
  return null;
}
