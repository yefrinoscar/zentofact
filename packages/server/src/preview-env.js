// Detección de entornos Railway PR preview y flags de seed de demo.

function envFlag(env, name) {
  return String(env[name] || '').trim().toLowerCase();
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function isFalsy(value) {
  return ['0', 'false', 'no', 'off'].includes(value);
}

export function railwayEnvironmentName(env = process.env) {
  return String(env.RAILWAY_ENVIRONMENT_NAME || '').trim();
}

export function isRailwayPrPreview(env = process.env) {
  const name = railwayEnvironmentName(env);
  return /^zentofact-pr-\d+$/i.test(name) || /^pr-\d+$/i.test(name);
}

export function isProductionEnvironment(env = process.env) {
  const name = railwayEnvironmentName(env).toLowerCase();
  if (name === 'production') return true;
  if (String(env.RAILWAY_ENVIRONMENT || '').trim().toLowerCase() === 'production') return true;
  return false;
}

/**
 * Seed automático de datos demo:
 * - En PR preview (`zentofact-pr-*`) corre por defecto.
 * - `SEED_PREVIEW=false` o `SKIP_PREVIEW_SEED=true` lo apaga por completo
 *   (ni schema de auth, ni admin, ni datos demo).
 * - `SEED_PREVIEW=true` lo fuerza fuera de production (p. ej. local).
 * - Nunca corre en production.
 */
export function shouldSeedPreview(env = process.env) {
  if (isProductionEnvironment(env)) return false;

  const seedFlag = envFlag(env, 'SEED_PREVIEW');
  const skipFlag = envFlag(env, 'SKIP_PREVIEW_SEED');
  if (isFalsy(seedFlag) || isTruthy(skipFlag)) return false;
  if (isTruthy(seedFlag)) return true;
  return isRailwayPrPreview(env);
}
