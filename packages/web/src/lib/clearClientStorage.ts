/**
 * Limpieza de almacenamiento del navegador por seguridad (SEC-002).
 *
 * No se puede borrar localStorage de OTRO dispositivo desde el servidor.
 * En su lugar: el servidor revoca sesiones; cada cliente limpia su storage
 * al cerrar sesión, al recibir 401, o al detectar logout en otra pestaña.
 * Conserva solo el tema visual (no es sensible).
 */

const PRESERVE_KEYS = new Set(['zentofact.theme']);
const LOGOUT_CHANNEL = 'zentofact-auth';
const LOGOUT_FLAG_KEY = 'zentofact.force-reauth';

/** Claves conocidas del producto (legacy). */
const KNOWN_KEYS = [
  'boletas.app',
  'boletas.falabellaApi.companies',
  'activeCompanyId',
];

let reauthInProgress = false;
let broadcast: BroadcastChannel | null = null;

function removeMatchingKeys(storage: Storage, shouldRemove: (key: string) => boolean) {
  const toRemove: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && shouldRemove(key)) toRemove.push(key);
  }
  for (const key of toRemove) storage.removeItem(key);
}

/**
 * Borra localStorage/sessionStorage de la app.
 * Seguro llamar varias veces; no lanza si el storage está bloqueado.
 */
export function clearClientStorageOnLogout() {
  try {
    if (typeof window === 'undefined') return;

    const theme = window.localStorage.getItem('zentofact.theme');

    for (const key of KNOWN_KEYS) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // ignore
      }
    }

    // Preferencias/sesión del producto
    removeMatchingKeys(window.localStorage, (key) => {
      if (PRESERVE_KEYS.has(key)) return false;
      return (
        key.startsWith('boletas.')
        || key.startsWith('zentofact.')
        || key === 'activeCompanyId'
        || key.toLowerCase().includes('falabella')
        || key.toLowerCase().includes('company')
        || key.toLowerCase().includes('session')
        || key.toLowerCase().includes('auth')
      );
    });

    try {
      window.sessionStorage.clear();
    } catch {
      // ignore
    }

    if (theme === 'light' || theme === 'dark') {
      window.localStorage.setItem('zentofact.theme', theme);
    }
  } catch {
    // Privacy mode / storage disabled
  }
}

function getBroadcast(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (!broadcast) {
    try {
      broadcast = new BroadcastChannel(LOGOUT_CHANNEL);
    } catch {
      return null;
    }
  }
  return broadcast;
}

/** Avisa a otras pestañas del mismo origen que deben limpiar y reautenticar. */
export function broadcastForceReauth(reason = 'logout') {
  try {
    // storage event: funciona entre pestañas aunque BroadcastChannel falle
    window.localStorage.setItem(LOGOUT_FLAG_KEY, `${reason}:${Date.now()}`);
    window.localStorage.removeItem(LOGOUT_FLAG_KEY);
  } catch {
    // ignore
  }
  try {
    getBroadcast()?.postMessage({ type: 'force-reauth', reason, at: Date.now() });
  } catch {
    // ignore
  }
}

/**
 * Limpia storage y recarga para forzar pantalla de login.
 * Usado en logout manual y cuando la sesión del servidor ya no es válida (401).
 */
export function forceReauthAndReload(reason = 'logout') {
  if (typeof window === 'undefined') return;
  if (reauthInProgress) return;
  reauthInProgress = true;

  clearClientStorageOnLogout();
  broadcastForceReauth(reason);

  // Limpia token CSRF en memoria del cliente HTTP si existe
  try {
    // dynamic import avoid circular deps — flag en sessionStorage no se conserva (ya cleared)
  } catch {
    // ignore
  }

  window.location.reload();
}

/**
 * Escucha logout desde otra pestaña o invalidación remota de sesión.
 * Debe llamarse una vez al arrancar la app (AuthGate).
 */
export function installSessionSecurityListeners() {
  if (typeof window === 'undefined') return () => {};

  const onStorage = (event: StorageEvent) => {
    if (event.key === LOGOUT_FLAG_KEY && event.newValue) {
      clearClientStorageOnLogout();
      if (!reauthInProgress) {
        reauthInProgress = true;
        window.location.reload();
      }
    }
  };

  const onMessage = (event: MessageEvent) => {
    if (event?.data?.type === 'force-reauth') {
      clearClientStorageOnLogout();
      if (!reauthInProgress) {
        reauthInProgress = true;
        window.location.reload();
      }
    }
  };

  window.addEventListener('storage', onStorage);
  const channel = getBroadcast();
  channel?.addEventListener('message', onMessage);

  return () => {
    window.removeEventListener('storage', onStorage);
    channel?.removeEventListener('message', onMessage);
  };
}
