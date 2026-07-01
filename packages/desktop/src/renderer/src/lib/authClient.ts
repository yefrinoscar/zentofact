import { createAuthClient } from 'better-auth/react';

// Cliente de auth (Better Auth) para la versión web. Apunta al backend @boletas/server.
export const authClient = createAuthClient({
  baseURL: (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001',
});

// La web requiere auth; el desktop usa IPC local y no la necesita.
export const isWeb = !(window as any).electronAPI;
