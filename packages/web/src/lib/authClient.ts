import { createAuthClient } from 'better-auth/react';

// Cliente de auth (Better Auth) para la versión web. Apunta al backend @zentofact/server.
export const authClient = createAuthClient({
  // Mismo origen que el front (o VITE_API_URL en dev).
  baseURL: (import.meta as any).env?.VITE_API_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3010'),
});
