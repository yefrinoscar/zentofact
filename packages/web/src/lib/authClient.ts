import { createAuthClient } from 'better-auth/react';

// Cliente de auth (Better Auth) para la versión web. Apunta al backend @zentofact/server.
export const authClient = createAuthClient({
  // Mismo origen que el front (o VITE_API_URL en dev).
  baseURL: (import.meta as any).env?.VITE_API_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3010'),
});

// La web requiere auth; el desktop usa IPC local y no la necesita.
export const isWeb = !(window as any).electronAPI;
