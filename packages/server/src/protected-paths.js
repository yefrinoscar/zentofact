export const PROTECTED_PATHS = [
  '/dashboard',
  '/orders-inbox',
  '/companies',
  '/branches',
  '/boletas',
  '/facturas',
  '/documentos',
  '/credit-notes',
  '/falabella',
  '/workflow',
  '/auto-emit',
  '/users',
  '/me',
];

export function isProtectedPath(path) {
  return PROTECTED_PATHS.some((prefix) => path === prefix || path.startsWith(prefix + '/'));
}
