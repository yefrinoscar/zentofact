type EnvLike = {
  VITE_APP_ENV?: string;
  VITE_SUNAT_ENV?: string;
  DEV?: boolean;
};

function currentHostname() {
  return typeof window === 'undefined' ? '' : window.location.hostname;
}

export function isProductionApp(
  env: EnvLike = import.meta.env,
  hostname = currentHostname(),
) {
  const appEnv = String(env.VITE_APP_ENV || '').trim().toLowerCase();
  if (appEnv === 'production') return true;
  if (appEnv === 'development') return false;
  if (env.DEV) return false;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return false;
  if (hostname.includes('development')) return false;
  return true;
}

export function isLocalApp(env: EnvLike = import.meta.env, hostname = currentHostname()) {
  if (env.DEV) return true;
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export function isDevApp(env: EnvLike = import.meta.env, hostname = currentHostname()) {
  return !isProductionApp(env, hostname);
}

export type AppEnvironmentKind = 'production' | 'local' | 'development';

export function appEnvironmentKind(
  env: EnvLike = import.meta.env,
  hostname = currentHostname(),
): AppEnvironmentKind {
  if (isProductionApp(env, hostname)) return 'production';
  if (isLocalApp(env, hostname)) return 'local';
  return 'development';
}

export function runtimeEnvironmentLabel(env: EnvLike = import.meta.env, hostname = currentHostname()) {
  const forcedSunat = String(env.VITE_SUNAT_ENV || '').trim().toLowerCase();
  const kind = appEnvironmentKind(env, hostname);
  const appEnv = kind === 'production' ? 'Producción' : kind === 'local' ? 'Local' : 'Desarrollo';
  const sunatEnv = forcedSunat === 'produccion' ? 'SUNAT prod.' : forcedSunat === 'beta' ? 'SUNAT beta' : '';
  return sunatEnv ? `${appEnv} · ${sunatEnv}` : appEnv;
}

const BRANDING = {
  local: {
    favicon: '/favicon-local.svg?v=1',
    themeColor: '#A3E635',
    titlePrefix: 'LOCAL · ',
  },
  development: {
    favicon: '/favicon-dev.svg?v=3',
    themeColor: '#FBBF24',
    titlePrefix: 'DEV · ',
  },
} as const;

export function applyDevBranding() {
  if (typeof document === 'undefined') return;
  const kind = appEnvironmentKind();
  if (kind === 'production') return;

  const branding = BRANDING[kind];
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"]')) {
    link.href = branding.favicon;
  }

  const theme = document.querySelector('meta[name="theme-color"]');
  if (theme) theme.setAttribute('content', branding.themeColor);

  const prefixes = Object.values(BRANDING).map((item) => item.titlePrefix);
  const bareTitle = prefixes.reduce((title, prefix) => (
    title.startsWith(prefix) ? title.slice(prefix.length) : title
  ), document.title);
  document.title = `${branding.titlePrefix}${bareTitle}`;
}
