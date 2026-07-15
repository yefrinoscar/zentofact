import { createAuthClient } from 'better-auth/react';

// Mantener auth en el mismo origen evita que Safari bloquee la cookie de sesión.
export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3010',
});
