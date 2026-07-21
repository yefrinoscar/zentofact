/**
 * El ambiente de emisión SUNAT lo define el proceso (env), no cada empresa.
 * - SUNAT_FORCE_ENV=produccion|prod → producción
 * - SUNAT_FORCE_ENV=beta|dev|local → beta
 * - sin flag: producción en Railway / NODE_ENV=production; si no, beta
 */
export function isSunatProduction(): boolean {
  const forced = String(process.env.SUNAT_FORCE_ENV || '').trim().toLowerCase();
  if (forced.startsWith('prod')) return true;
  if (forced === 'beta' || forced === 'dev' || forced === 'development' || forced === 'local' || forced === 'test') {
    return false;
  }
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return true;
  return process.env.NODE_ENV === 'production';
}

export function sunatEnvironmentLabel(): 'produccion' | 'beta' {
  return isSunatProduction() ? 'produccion' : 'beta';
}
