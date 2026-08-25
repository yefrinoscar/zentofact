export const PROTECTED_PATHS = [
  '/dashboard',
  '/orders-inbox',
  '/order-attention',
  '/order-management',
  '/products',
  '/product-listings',
  '/inventory',
  '/catalog',
  '/companies',
  '/branches',
  '/boletas',
  '/facturas',
  '/documentos',
  '/credit-notes',
  '/falabella',
  '/ripley',
  '/workflow',
  '/auto-emit',
  '/system',
  '/users',
  '/me',
  '/insumos',
];

export function isProtectedPath(path) {
  return PROTECTED_PATHS.some((prefix) => path === prefix || path.startsWith(prefix + '/'));
}
