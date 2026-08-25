// Detección de entornos Railway PR preview y flags de seed de demo.

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

/** Seed automático solo en PR preview, o con SEED_PREVIEW=true fuera de production. */
export function shouldSeedPreview(env = process.env) {
  if (isProductionEnvironment(env)) return false;
  const flag = String(env.SEED_PREVIEW || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(flag)) return true;
  return isRailwayPrPreview(env);
}
