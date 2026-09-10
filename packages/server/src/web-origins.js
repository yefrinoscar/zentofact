import { localAuthOriginPatterns, localWebOrigins } from './local-web-origins.js';

// Public LIMBO origin. Production login rejects callbackURL until this is deployed.
export const CANONICAL_WEB_ORIGINS = [
  'https://limbo.zentolabs.com',
];

export const CANONICAL_AUTH_ORIGIN_PATTERNS = [
  'https://*.zentolabs.com',
];

function originFromUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).origin;
  } catch {
    return '';
  }
}

export function isZentolabsOrigin(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:'
      && (url.hostname === 'zentolabs.com' || url.hostname.endsWith('.zentolabs.com'));
  } catch {
    return false;
  }
}

export function railwayServiceOrigins(env = process.env) {
  const origins = [];
  const publicDomain = String(env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  if (publicDomain) origins.push(`https://${publicDomain}`);
  for (const key of ['RAILWAY_SERVICE_ZENTOFACT_WEB_URL', 'RAILWAY_STATIC_URL']) {
    const origin = originFromUrl(env[key]);
    if (origin) origins.push(origin);
  }
  return [...new Set(origins)];
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
