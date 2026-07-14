const DEV_LOADING_DELAY_STORAGE_KEY = 'zentofact.dev.loading-delay-enabled';

const delayEnabledByDefault = import.meta.env.DEV
  && String(import.meta.env.VITE_DEV_LOADING_DELAY_ENABLED || '').toLowerCase() === 'true';

const configuredDelay = Number(import.meta.env.VITE_DEV_LOADING_DELAY_MS || 0);

export const devLoadingDelayMs = Number.isFinite(configuredDelay)
  ? Math.min(Math.max(configuredDelay, 0), 10_000)
  : 0;

export function isDevLoadingDelayEnabled() {
  if (!import.meta.env.DEV) return false;
  try {
    const stored = localStorage.getItem(DEV_LOADING_DELAY_STORAGE_KEY);
    return stored == null ? delayEnabledByDefault : stored === 'true';
  } catch {
    return delayEnabledByDefault;
  }
}

export function setDevLoadingDelayEnabled(enabled: boolean) {
  if (!import.meta.env.DEV) return;
  try {
    localStorage.setItem(DEV_LOADING_DELAY_STORAGE_KEY, String(enabled));
  } catch {
    // Ignorar si el navegador bloquea el almacenamiento local.
  }
}

/** Mantiene visible el estado inicial durante un mínimo configurable en dev. */
export async function waitForDevLoadingDelay(startedAt: number) {
  if (!isDevLoadingDelayEnabled()) return;
  const remaining = devLoadingDelayMs - (Date.now() - startedAt);
  if (remaining <= 0) return;
  await new Promise<void>((resolve) => window.setTimeout(resolve, remaining));
}
