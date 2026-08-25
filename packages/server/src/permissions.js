// Catálogo de permisos por sección y subsección del menú.
// Los administradores ignoran la lista persistida y conservan acceso total.

export const PERMISSIONS = [
  { key: 'dashboard', label: 'Dashboard', description: 'Ver ventas y métricas consolidadas', path: '/dashboard', section: 'operation' },
  { key: 'falabella_sellers', label: 'Falabella', description: 'Gestionar sellers, órdenes y sincronización de Falabella', path: '/falabella-api', section: 'operation' },
  { key: 'salesperson', label: 'Mis ventas', description: 'Ver tus ventas del día y del mes y registrar una venta', path: '/mis-ventas', section: 'orders' },
  { key: 'order_management', label: 'Todos los pedidos', description: 'Consultar y registrar pedidos de todos los canales', path: '/orders', section: 'orders' },
  { key: 'productos', label: 'Productos', description: 'Gestionar el catálogo multi-seller y el inventario compartido', path: '/productos', section: 'operation', hiddenInProduction: true },
  { key: 'salidas', label: 'Salidas de hoy', description: 'Ver productos vendidos hoy y la cantidad que salió del almacén', path: '/salidas', section: 'operation' },
  { key: 'insumos', label: 'Insumos', description: 'Ver y actualizar la cantidad de materiales de empaque y oficina', path: '/insumos', section: 'operation' },
  { key: 'orders_inbox', label: 'Recepción de pedidos', description: 'Recibir, revisar y preparar pedidos para despacho', path: '/pedidos', section: 'orders' },
  { key: 'orders_scanner', label: 'Preparación y escaneo', description: 'Escanear etiquetas y revisar el contenido de los bultos', path: '/scanner', section: 'orders' },
  { key: 'boletas', label: 'Boletas', description: 'Ver, emitir y reenviar boletas electrónicas', path: '/boletas', section: 'documents' },
  { key: 'facturas', label: 'Facturas', description: 'Ver, emitir y reenviar facturas electrónicas', path: '/facturas', section: 'documents' },
  { key: 'credit_notes_manage', label: 'Notas de crédito', description: 'Consultar y emitir notas de crédito individuales', path: '/credit-notes', section: 'documents' },
  { key: 'auto_emision', label: 'Automatización', description: 'Administrar emisión automática y webhooks', path: '/auto-emision', section: 'documents' },
  { key: 'credit_notes_bulk', label: 'Anulación masiva', description: 'Anular boletas en lote con notas de crédito', path: '/credit-notes/bulk', section: 'documents' },
  { key: 'companies', label: 'Empresas', description: 'Administrar empresas, credenciales y certificados', path: '/companies', section: 'config' },
  { key: 'users', label: 'Usuarios', description: 'Administrar usuarios, roles y permisos', path: '/users', section: 'config' },
  { key: 'settings', label: 'Ajustes', description: 'Cambiar preferencias y apariencia', path: '/settings', section: 'config' },
];

export const ALL_PERMISSION_KEYS = PERMISSIONS.map((permission) => permission.key);

export const ROLE_PRESETS = {
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
  falabella_manager: {
    label: 'Perfil anterior',
    description: 'Perfil anterior conservado por compatibilidad',
    permissions: ['falabella_sellers'],
  },
  operator: {
    label: 'Operador',
    description: 'Recibe pedidos y realiza la preparación y el escaneo',
    permissions: ['order_management', 'orders_inbox', 'orders_scanner', 'salidas', 'insumos'],
  },
  billing: {
    label: 'Facturación',
    description: 'Gestiona comprobantes, automatización y anulaciones',
    permissions: ['boletas', 'facturas', 'credit_notes_manage', 'auto_emision', 'credit_notes_bulk'],
  },
  vendedor: {
    label: 'Vendedor',
    description: 'Registra ventas y consulta su comisión',
    permissions: ['salesperson'],
  },
  viewer: {
    label: 'Perfil anterior',
    description: 'Perfil anterior conservado por compatibilidad',
    permissions: ['falabella_sellers', 'orders_inbox', 'boletas', 'facturas', 'credit_notes_manage'],
  },
};

export const SELECTABLE_ROLES = ['superadmin', 'admin', 'operator', 'billing', 'vendedor'];

export const ROLE_RANK = {
  viewer: 10,
  operator: 20,
  billing: 20,
  vendedor: 20,
  falabella_manager: 20,
  admin: 80,
  superadmin: 100,
};

const LEGACY_PERMISSION_MAP = {
  falabella: ['falabella_sellers', 'orders_inbox', 'orders_scanner', 'order_management'],
  documentos: ['boletas', 'facturas', 'credit_notes_manage'],
  credit_notes: ['credit_notes_manage', 'credit_notes_bulk'],
};

const LEGACY_OPERATOR_PRESET = [
  'dashboard', 'documentos', 'falabella', 'productos', 'auto_emision',
  'credit_notes', 'companies', 'settings',
];
const LEGACY_VIEWER_PRESET = ['dashboard', 'documentos', 'falabella', 'productos', 'settings'];
const INTERIM_OPERATOR_PRESET = [
  'falabella_sellers', 'orders_inbox', 'orders_scanner', 'boletas',
  'facturas', 'credit_notes_manage', 'settings',
];
const RECENT_OPERATOR_PRESET = ['falabella_sellers', 'orders_inbox', 'orders_scanner'];
const PREVIOUS_OPERATOR_PRESET = ['orders_inbox', 'orders_scanner'];
const OPERATOR_WITHOUT_SALIDAS = ['order_management', 'orders_inbox', 'orders_scanner'];
const OPERATOR_WITHOUT_INSUMOS = ['order_management', 'orders_inbox', 'orders_scanner', 'salidas'];
const INTERIM_BILLING_PRESET = ['boletas', 'facturas', 'credit_notes_manage'];
const INTERIM_VIEWER_PRESET = [
  'falabella_sellers', 'orders_inbox', 'boletas', 'facturas',
  'credit_notes_manage', 'settings',
];

function samePermissionSet(list, expected) {
  const current = new Set(list.map((key) => String(key || '').trim()).filter(Boolean));
  return current.size === expected.length && expected.every((key) => current.has(key));
}

export function normalizeRole(role) {
  const value = String(role || '').trim();
  return ROLE_PRESETS[value] ? value : 'operator';
}

export function roleRank(role) {
  return ROLE_RANK[normalizeRole(role)] || ROLE_RANK.operator;
}

export function isAdminRole(role) {
  return roleRank(role) >= ROLE_RANK.admin;
}

export function isSuperadminRole(role) {
  return normalizeRole(role) === 'superadmin';
}

export function isPermissionsLocked(role) {
  const normalized = normalizeRole(role);
  return isAdminRole(normalized) || normalized === 'vendedor';
}

export function normalizePermissions(input, role = 'operator') {
  const normalizedRole = normalizeRole(role);
  if (isAdminRole(normalizedRole)) return [...ALL_PERMISSION_KEYS];
  if (normalizedRole === 'vendedor') return [...ROLE_PRESETS.vendedor.permissions];
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
  if (list.map((key) => String(key || '').trim()).filter(Boolean).length === 0) {
    if (normalizedRole === 'operator') return [...ROLE_PRESETS.operator.permissions];
    if (normalizedRole === 'billing') return [...ROLE_PRESETS.billing.permissions];
  }
  if (normalizedRole === 'operator' && (
    samePermissionSet(list, LEGACY_OPERATOR_PRESET)
    || samePermissionSet(list, INTERIM_OPERATOR_PRESET)
    || samePermissionSet(list, RECENT_OPERATOR_PRESET)
    || samePermissionSet(list, PREVIOUS_OPERATOR_PRESET)
    || samePermissionSet(list, OPERATOR_WITHOUT_SALIDAS)
    || samePermissionSet(list, OPERATOR_WITHOUT_INSUMOS)
  )) return [...ROLE_PRESETS.operator.permissions];
  if (normalizedRole === 'billing' && samePermissionSet(list, INTERIM_BILLING_PRESET)) {
    return [...ROLE_PRESETS.billing.permissions];
  }
  if (normalizedRole === 'viewer' && (
    samePermissionSet(list, LEGACY_VIEWER_PRESET)
    || samePermissionSet(list, INTERIM_VIEWER_PRESET)
  )) return [...ROLE_PRESETS.viewer.permissions];
  const expanded = list.flatMap((key) => {
    const clean = String(key || '').trim();
    return LEGACY_PERMISSION_MAP[clean] || [clean];
  });
  const allowed = new Set(ALL_PERMISSION_KEYS.filter((key) => key !== 'dashboard' && key !== 'users' && key !== 'salesperson'));
  return [...new Set(expanded.filter((key) => allowed.has(key)))];
}

export function permissionsForRole(role) {
  const normalizedRole = normalizeRole(role);
  const preset = ROLE_PRESETS[normalizedRole];
  if (isAdminRole(normalizedRole)) return [...ALL_PERMISSION_KEYS];
  return preset ? [...preset.permissions] : [...ROLE_PRESETS.operator.permissions];
}

export function userHasPermission(user, key) {
  if (!user) return false;
  if (user.active === false || user.active === 'false') return false;
  const role = normalizeRole(user.role);
  if (key === 'users' || key === 'dashboard') return isAdminRole(role);
  if (isAdminRole(role)) return true;
  return normalizePermissions(user.permissions, role).includes(key);
}

export function pathPermission(pathname) {
  if (!pathname) return null;
  if (pathname.startsWith('/dashboard')) return 'dashboard';
  if (pathname.startsWith('/mis-ventas')) return 'salesperson';
  if (pathname.startsWith('/orders')) return 'order_management';
  if (pathname.startsWith('/pedidos')) return 'orders_inbox';
  if (pathname.startsWith('/scanner')) return 'orders_scanner';
  if (pathname.startsWith('/boletas')) return 'boletas';
  if (pathname.startsWith('/facturas')) return 'facturas';
  if (pathname.startsWith('/documentos') || pathname.startsWith('/individual-invoice')) return 'boletas';
  if (pathname.startsWith('/falabella-api') || pathname.startsWith('/workflow')) return 'falabella_sellers';
  if (pathname.startsWith('/productos')) return 'productos';
  if (pathname.startsWith('/salidas')) return 'salidas';
  if (pathname.startsWith('/insumos')) return 'insumos';
  if (pathname.startsWith('/auto-emision')) return 'auto_emision';
  if (pathname.startsWith('/credit-notes/bulk')) return 'credit_notes_bulk';
  if (pathname.startsWith('/credit-notes')) return 'credit_notes_manage';
  if (pathname.startsWith('/companies')) return 'companies';
  if (pathname.startsWith('/settings')) return 'settings';
  if (pathname.startsWith('/users')) return 'users';
  return null;
}
