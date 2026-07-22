export type PermissionKey =
  | 'dashboard'
  | 'documentos'
  | 'falabella'
  | 'productos'
  | 'auto_emision'
  | 'credit_notes'
  | 'companies'
  | 'settings'
  | 'users';

export type AppRole = 'superadmin' | 'admin' | 'operator' | 'viewer';

export type PermissionDef = {
  key: PermissionKey;
  label: string;
  description: string;
  path: string;
};

export const PERMISSIONS: PermissionDef[] = [
  { key: 'dashboard', label: 'Dashboard', description: 'Ver ventas y métricas consolidadas', path: '/dashboard' },
  { key: 'documentos', label: 'Comprobantes', description: 'Ver y emitir boletas/facturas; ver notas de crédito', path: '/boletas' },

  { key: 'falabella', label: 'Falabella', description: 'Gestor de sellers y órdenes', path: '/falabella-api' },
  { key: 'productos', label: 'Productos', description: 'Catálogo de productos Falabella', path: '/productos' },
  { key: 'auto_emision', label: 'Automatización', description: 'Emisión automática y webhooks', path: '/auto-emision' },
  { key: 'credit_notes', label: 'Anulación masiva', description: 'Anular boletas en lote con notas de crédito', path: '/credit-notes/bulk' },
  { key: 'companies', label: 'Empresas', description: 'Alta y credenciales de empresas', path: '/companies' },
  { key: 'settings', label: 'Ajustes', description: 'Preferencias y apariencia', path: '/settings' },
  { key: 'users', label: 'Usuarios', description: 'Administrar usuarios y permisos', path: '/users' },
];

export const ALL_PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

export const ROLE_PRESETS: Record<AppRole, { label: string; description: string; permissions: PermissionKey[] }> = {
  superadmin: {
    label: 'Superadministrador',
    description: 'Gestiona administradores, seguridad y recuperación del sistema',
    permissions: [...ALL_PERMISSION_KEYS],
  },
  admin: {
    label: 'Administrador',
    description: 'Acceso total a todos los módulos',
    permissions: [...ALL_PERMISSION_KEYS],
  },
  operator: {
    label: 'Operador',
    description: 'Operación diaria sin administrar usuarios',
    permissions: ALL_PERMISSION_KEYS.filter((k) => k !== 'users') as PermissionKey[],
  },
  viewer: {
    label: 'Consulta',
    description: 'Solo lectura de documentos, Falabella y productos',
    permissions: ['dashboard', 'documentos', 'falabella', 'productos', 'settings'],
  },
};

export const ROLE_RANK: Record<AppRole, number> = {
  viewer: 10,
  operator: 20,
  admin: 80,
  superadmin: 100,
};

export function normalizeRole(role: unknown): AppRole {
  const value = String(role || 'operator');
  return value in ROLE_PRESETS ? value as AppRole : 'operator';
}

export function isAdminRole(role: unknown) {
  return ROLE_RANK[normalizeRole(role)] >= ROLE_RANK.admin;
}

export function isSuperadminRole(role: unknown) {
  return normalizeRole(role) === 'superadmin';
}

export type AppUser = {
  id: string;
  name: string;
  email: string;
  role?: string;
  permissions?: string[] | string;
  active?: boolean;
};

export function parsePermissions(raw: unknown, role = 'operator'): PermissionKey[] {
  if (isAdminRole(role)) return [...ALL_PERMISSION_KEYS];
  let list: string[] = [];
  if (Array.isArray(raw)) list = raw.map(String);
  else if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      list = Array.isArray(parsed) ? parsed.map(String) : raw.split(',');
    } catch {
      list = raw.split(',');
    }
  }
  const allowed = new Set(ALL_PERMISSION_KEYS);
  return [...new Set(list.map((x) => x.trim()).filter((k): k is PermissionKey => allowed.has(k as PermissionKey)))];
}

export function userHasPermission(user: AppUser | null | undefined, key: PermissionKey): boolean {
  if (!user) return false;
  if (user.active === false) return false;
  const role = normalizeRole(user.role);
  if (key === 'users') return isAdminRole(role);
  if (isAdminRole(role)) return true;
  return parsePermissions(user.permissions, role).includes(key);
}

export function pathPermission(pathname: string): PermissionKey | null {
  if (pathname.startsWith('/dashboard')) return 'dashboard';
  if (pathname.startsWith('/pedidos')) return 'falabella';
  if (pathname.startsWith('/boletas') || pathname.startsWith('/facturas')) return 'documentos';
  if (pathname.startsWith('/documentos') || pathname.startsWith('/individual-invoice')) return 'documentos';
  if (pathname.startsWith('/falabella-api') || pathname.startsWith('/workflow')) return 'falabella';
  if (pathname.startsWith('/productos')) return 'productos';
  if (pathname.startsWith('/auto-emision')) return 'auto_emision';
  if (pathname.startsWith('/credit-notes/bulk')) return 'credit_notes';
  if (pathname.startsWith('/credit-notes')) return 'documentos';
  if (pathname.startsWith('/companies')) return 'companies';
  if (pathname.startsWith('/settings')) return 'settings';
  if (pathname.startsWith('/users')) return 'users';
  return null;
}

export function firstAllowedPath(user: AppUser | null | undefined): string {
  for (const p of PERMISSIONS) {
    if (userHasPermission(user, p.key)) return p.path;
  }
  return '/settings';
}
