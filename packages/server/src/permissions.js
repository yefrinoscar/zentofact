// Catálogo de permisos = opciones del menú / módulos de la app.
// role=admin ignora la lista y tiene acceso total.

export const PERMISSIONS = [
  { key: 'documentos', label: 'Documentos', description: 'Ver y emitir boletas/facturas', path: '/documentos' },
  { key: 'falabella', label: 'Falabella', description: 'Gestor de sellers y órdenes', path: '/falabella-api' },
  { key: 'productos', label: 'Productos', description: 'Catálogo de productos Falabella', path: '/productos' },
  { key: 'auto_emision', label: 'Automatización', description: 'Emisión automática y webhooks', path: '/auto-emision' },
  { key: 'credit_notes', label: 'Notas de crédito', description: 'Anular boletas con NC', path: '/credit-notes' },
  { key: 'companies', label: 'Empresas', description: 'Alta y credenciales de empresas', path: '/companies' },
  { key: 'settings', label: 'Ajustes', description: 'Preferencias y apariencia', path: '/settings' },
  { key: 'users', label: 'Usuarios', description: 'Administrar usuarios y permisos', path: '/users' },
];

export const ALL_PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

export const ROLE_PRESETS = {
  admin: {
    label: 'Administrador',
    description: 'Acceso total a todos los módulos',
    permissions: [...ALL_PERMISSION_KEYS],
  },
  operator: {
    label: 'Operador',
    description: 'Operación diaria sin administrar usuarios',
    permissions: ALL_PERMISSION_KEYS.filter((k) => k !== 'users'),
  },
  viewer: {
    label: 'Consulta',
    description: 'Solo lectura de documentos, Falabella y productos',
    permissions: ['documentos', 'falabella', 'productos', 'settings'],
  },
};

export function normalizePermissions(input, role = 'operator') {
  if (role === 'admin') return [...ALL_PERMISSION_KEYS];
  const list = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? (() => {
          try {
            const parsed = JSON.parse(input);
            return Array.isArray(parsed) ? parsed : String(input).split(',');
          } catch {
            return String(input).split(',');
          }
        })()
      : [];
  const allowed = new Set(ALL_PERMISSION_KEYS);
  return [...new Set(list.map((x) => String(x || '').trim()).filter((k) => allowed.has(k)))];
}

export function permissionsForRole(role) {
  const preset = ROLE_PRESETS[role];
  if (role === 'admin') return [...ALL_PERMISSION_KEYS];
  return preset ? [...preset.permissions] : [...ROLE_PRESETS.operator.permissions];
}

export function userHasPermission(user, key) {
  if (!user) return false;
  if (user.active === false || user.active === 'false') return false;
  const role = String(user.role || 'operator');
  if (role === 'admin') return true;
  const perms = normalizePermissions(user.permissions, role);
  return perms.includes(key);
}

export function pathPermission(pathname) {
  if (!pathname) return null;
  if (pathname.startsWith('/documentos') || pathname.startsWith('/individual-invoice')) return 'documentos';
  if (pathname.startsWith('/falabella-api') || pathname.startsWith('/workflow')) return 'falabella';
  if (pathname.startsWith('/productos')) return 'productos';
  if (pathname.startsWith('/auto-emision')) return 'auto_emision';
  if (pathname.startsWith('/credit-notes')) return 'credit_notes';
  if (pathname.startsWith('/companies')) return 'companies';
  if (pathname.startsWith('/settings')) return 'settings';
  if (pathname.startsWith('/users')) return 'users';
  return null;
}
