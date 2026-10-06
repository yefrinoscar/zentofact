export type PermissionKey =
  | 'dashboard'
  | 'pagos'
  | 'falabella_sellers'
  | 'salesperson'
  | 'order_management'
  | 'return_stock_approve'
  | 'productos'
  | 'insumos'
  | 'orders_inbox'
  | 'orders_scanner'
  | 'boletas'
  | 'facturas'
  | 'credit_notes_manage'
  | 'auto_emision'
  | 'credit_notes_bulk'
  | 'companies'
  | 'settings'
  | 'users';

export type PermissionSectionKey = 'operation' | 'orders' | 'documents' | 'config';

export type AppRole =
  | 'superadmin'
  | 'admin'
  | 'falabella_manager'
  | 'operator'
  | 'billing'
  | 'vendedor'
  | 'viewer';

export type PermissionDef = {
  key: PermissionKey;
  label: string;
  description: string;
  path: string;
  section: PermissionSectionKey;
  hiddenInProduction?: boolean;
};

export const PERMISSION_SECTIONS: Array<{ key: PermissionSectionKey; label: string }> = [
  { key: 'operation', label: 'Operación' },
  { key: 'orders', label: 'Pedidos' },
  { key: 'documents', label: 'Comprobantes' },
  { key: 'config', label: 'Configuración' },
];

// El orden también define la primera pantalla disponible para cada usuario.
export const PERMISSIONS: PermissionDef[] = [
  { key: 'dashboard', label: 'Dashboard', description: 'Ver ventas y métricas consolidadas', path: '/dashboard', section: 'operation' },
  { key: 'pagos', label: 'Pagos', description: 'Ver lo que Falabella cobra por cada venta y cruzar liquidaciones', path: '/pagos', section: 'operation' },
  { key: 'falabella_sellers', label: 'Falabella', description: 'Gestionar sellers, órdenes y sincronización de Falabella', path: '/falabella-api', section: 'operation' },
  { key: 'salesperson', label: 'Mis ventas', description: 'Ver tus ventas del día y del mes y registrar una venta', path: '/mis-ventas', section: 'orders' },
  { key: 'order_management', label: 'Todos los pedidos', description: 'Consultar y registrar pedidos de todos los canales', path: '/orders', section: 'orders' },
  { key: 'return_stock_approve', label: 'Aprobar devoluciones', description: 'Revisar devoluciones y pasarlas al stock vendible', path: '/cancelados', section: 'orders' },
  { key: 'productos', label: 'Productos', description: 'Gestionar el catálogo multi-seller y el inventario compartido', path: '/productos', section: 'operation', hiddenInProduction: true },
  { key: 'orders_inbox', label: 'Recepción de pedidos', description: 'Recibir, revisar y preparar pedidos para despacho', path: '/bandeja', section: 'orders' },
  { key: 'orders_scanner', label: 'Preparación y escaneo', description: 'Escanear etiquetas y revisar el contenido de los bultos', path: '/scanner', section: 'orders' },
  { key: 'insumos', label: 'Insumos', description: 'Ver y actualizar la cantidad de materiales de empaque y oficina', path: '/insumos', section: 'orders' },
  { key: 'boletas', label: 'Boletas', description: 'Ver, emitir y reenviar boletas electrónicas', path: '/boletas', section: 'documents' },
  { key: 'facturas', label: 'Facturas', description: 'Ver, emitir y reenviar facturas electrónicas', path: '/facturas', section: 'documents' },
  { key: 'credit_notes_manage', label: 'Notas de crédito', description: 'Consultar y emitir notas de crédito individuales', path: '/credit-notes', section: 'documents' },
  { key: 'auto_emision', label: 'Automatización', description: 'Administrar emisión automática y webhooks', path: '/auto-emision', section: 'documents' },
  { key: 'credit_notes_bulk', label: 'Anulación masiva', description: 'Anular boletas en lote con notas de crédito', path: '/credit-notes/bulk', section: 'documents' },
  { key: 'companies', label: 'Empresas', description: 'Administrar empresas, credenciales y certificados', path: '/companies', section: 'config' },
  { key: 'users', label: 'Usuarios', description: 'Administrar usuarios, roles y permisos', path: '/users', section: 'config' },
  { key: 'settings', label: 'Ajustes', description: 'Cambiar preferencias, apariencia y envío propio', path: '/settings', section: 'config' },
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
  falabella_manager: {
    label: 'Perfil anterior',
    description: 'Perfil anterior conservado por compatibilidad',
    permissions: ['falabella_sellers'],
  },
  operator: {
    label: 'Operador',
    description: 'Recibe pedidos y realiza la preparación y el escaneo',
    permissions: ['order_management', 'return_stock_approve', 'orders_inbox', 'orders_scanner', 'insumos'],
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

export const SELECTABLE_ROLES: AppRole[] = ['superadmin', 'admin', 'operator', 'billing', 'vendedor'];

export const ROLE_RANK: Record<AppRole, number> = {
  viewer: 10,
  operator: 20,
  billing: 20,
  vendedor: 20,
  falabella_manager: 20,
  admin: 80,
  superadmin: 100,
};

// Traduce claves antiguas y reconoce los presets generales anteriores para
// reasignarlos al área real del perfil seleccionado.
const LEGACY_PERMISSION_MAP: Record<string, PermissionKey[]> = {
  falabella: ['falabella_sellers', 'orders_inbox', 'orders_scanner', 'order_management'],
  documentos: ['boletas', 'facturas', 'credit_notes_manage'],
  credit_notes: ['credit_notes_manage', 'credit_notes_bulk'],
};

const LEGACY_OPERATOR_PRESET = [
  'dashboard', 'documentos', 'falabella', 'productos', 'auto_emision',
  'credit_notes', 'companies', 'settings',
];
const LEGACY_VIEWER_PRESET = ['dashboard', 'documentos', 'falabella', 'productos', 'settings'];
const INTERIM_OPERATOR_PRESET: PermissionKey[] = [
  'falabella_sellers', 'orders_inbox', 'orders_scanner', 'boletas',
  'facturas', 'credit_notes_manage', 'settings',
];
const RECENT_OPERATOR_PRESET: PermissionKey[] = ['falabella_sellers', 'orders_inbox', 'orders_scanner'];
const PREVIOUS_OPERATOR_PRESET: PermissionKey[] = ['orders_inbox', 'orders_scanner'];
const OPERATOR_WITHOUT_SALIDAS: PermissionKey[] = ['order_management', 'orders_inbox', 'orders_scanner'];
const OPERATOR_WITHOUT_INSUMOS = ['order_management', 'orders_inbox', 'orders_scanner', 'salidas'];
const OPERATOR_WITH_SALIDAS = ['order_management', 'orders_inbox', 'orders_scanner', 'salidas', 'insumos'];
const OPERATOR_WITHOUT_RETURN_APPROVAL: PermissionKey[] = ['order_management', 'orders_inbox', 'orders_scanner', 'insumos'];
const INTERIM_BILLING_PRESET: PermissionKey[] = ['boletas', 'facturas', 'credit_notes_manage'];
const INTERIM_VIEWER_PRESET: PermissionKey[] = [
  'falabella_sellers', 'orders_inbox', 'boletas', 'facturas',
  'credit_notes_manage', 'settings',
];

function samePermissionSet(list: string[], expected: readonly string[]) {
  const current = new Set(list.map((key) => key.trim()).filter(Boolean));
  return current.size === expected.length && expected.every((key) => current.has(key));
}

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

export function isPermissionsLocked(role: unknown) {
  const normalized = normalizeRole(role);
  return isAdminRole(normalized) || normalized === 'vendedor';
}

export type AppUser = {
  id: string;
  name: string;
  email: string;
  role?: string;
  permissions?: string[] | string;
  roles?: string[];
  rolePermissions?: Record<string, string[] | string | null>;
  active?: boolean;
  commissionPercent?: number;
};

export function parsePermissions(raw: unknown, role = 'operator'): PermissionKey[] {
  if (isAdminRole(role)) return [...ALL_PERMISSION_KEYS];
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === 'vendedor') return [...ROLE_PRESETS.vendedor.permissions];
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
  if (list.map((key) => key.trim()).filter(Boolean).length === 0) {
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
    || samePermissionSet(list, OPERATOR_WITH_SALIDAS)
    || samePermissionSet(list, OPERATOR_WITHOUT_RETURN_APPROVAL)
  )) return [...ROLE_PRESETS.operator.permissions];
  if (normalizedRole === 'billing' && samePermissionSet(list, INTERIM_BILLING_PRESET)) {
    return [...ROLE_PRESETS.billing.permissions];
  }
  if (normalizedRole === 'viewer' && (
    samePermissionSet(list, LEGACY_VIEWER_PRESET)
    || samePermissionSet(list, INTERIM_VIEWER_PRESET)
  )) return [...ROLE_PRESETS.viewer.permissions];
  const expanded = list.flatMap((key) => {
    const clean = key.trim();
    return LEGACY_PERMISSION_MAP[clean] || [clean];
  });
  const allowed = new Set<PermissionKey>(ALL_PERMISSION_KEYS.filter((key) => key !== 'dashboard' && key !== 'pagos' && key !== 'users' && key !== 'salesperson'));
  return [...new Set(expanded.filter((key): key is PermissionKey => allowed.has(key as PermissionKey)))];
}

export function userHasPermission(user: AppUser | null | undefined, key: PermissionKey): boolean {
  if (!user) return false;
  if (user.active === false) return false;
  const admin = isAdminUser(user);
  if (key === 'users' || key === 'dashboard' || key === 'pagos') return admin;
  if (admin) return true;
  return permissionsForUser(user).includes(key);
}

// ── Multi-perfil ─────────────────────────────────────────────────────────────
// Un usuario puede pertenecer a varios perfiles; `role` es el perfil principal
// legacy. Los permisos se calculan como unión de pertenencias y permisos
// personalizados de cada asignación (`rolePermissions`).

function parsePermissionInput(input: unknown): string[] {
  if (Array.isArray(input)) return input.map((key) => String(key || '').trim()).filter(Boolean);
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) return parsed.map((key) => String(key || '').trim()).filter(Boolean);
    } catch {
      // Sigue como lista separada por comas.
    }
    return input.split(',').map((key) => key.trim()).filter(Boolean);
  }
  return [];
}

const NON_ADMIN_PERMISSION_KEYS = new Set<PermissionKey>(
  ALL_PERMISSION_KEYS.filter((key) => key !== 'dashboard' && key !== 'pagos' && key !== 'users' && key !== 'salesperson'),
);

/** Permisos explícitos de una asignación: un vacío explícito no restaura presets. */
export function explicitPermissions(input: unknown, role = 'operator'): PermissionKey[] {
  const normalizedRole = normalizeRole(role);
  if (isAdminRole(normalizedRole)) return [...ALL_PERMISSION_KEYS];
  if (normalizedRole === 'vendedor') return [...ROLE_PRESETS.vendedor.permissions];
  const expanded = parsePermissionInput(input).flatMap((key) => LEGACY_PERMISSION_MAP[key] || [key]);
  return [...new Set(expanded.filter((key): key is PermissionKey => NON_ADMIN_PERMISSION_KEYS.has(key as PermissionKey)))];
}

export function userRoleList(user: AppUser | null | undefined): AppRole[] {
  const raw = Array.isArray(user?.roles) ? user.roles : [];
  const valid = [...new Set(raw.map((value) => String(value || '').trim()).filter((value) => value in ROLE_PRESETS))];
  if (valid.length) return valid as AppRole[];
  return [normalizeRole(user?.role)];
}

export function userHasRole(user: AppUser | null | undefined, role: unknown) {
  return userRoleList(user).includes(normalizeRole(role));
}

export function isAdminUser(user: AppUser | null | undefined) {
  return userRoleList(user).some((role) => isAdminRole(role));
}

export function isSuperadminUser(user: AppUser | null | undefined) {
  return userRoleList(user).some((role) => normalizeRole(role) === 'superadmin');
}

/** Vendedor por pertenencia al perfil, no por el permiso (que admin también incluye). */
export function isSalespersonUser(user: AppUser | null | undefined) {
  return userRoleList(user).includes('vendedor');
}

/** Solo lectura si todas sus pertenencias son el perfil anterior `viewer`. */
export function isReadOnlyUser(user: AppUser | null | undefined) {
  const memberships = userRoleList(user);
  return memberships.length > 0 && memberships.every((role) => role === 'viewer');
}

function membershipGrants(user: AppUser | null | undefined) {
  const hasRoles = Array.isArray(user?.roles) && user.roles.length > 0;
  const memberships = userRoleList(user);
  const perRole = user?.rolePermissions && typeof user.rolePermissions === 'object' ? user.rolePermissions : null;
  const legacySingle = !hasRoles
    || (memberships.length === 1 && (!perRole || !Object.prototype.hasOwnProperty.call(perRole, memberships[0])));
  return memberships.map((role) => {
    if (isAdminRole(role)) return { role, readOnly: false, grants: [...ALL_PERMISSION_KEYS] };
    if (role === 'vendedor') return { role, readOnly: false, grants: [...ROLE_PRESETS.vendedor.permissions] };
    let grants: PermissionKey[];
    if (perRole && Object.prototype.hasOwnProperty.call(perRole, role)) {
      grants = explicitPermissions(perRole[role], role);
    } else if (legacySingle) {
      grants = parsePermissions(user?.permissions, role);
    } else {
      grants = [...ROLE_PRESETS[role].permissions];
    }
    return { role, readOnly: role === 'viewer', grants };
  });
}

/** Unión de los accesos de todas las pertenencias (lectura). */
export function permissionsForUser(user: AppUser | null | undefined): PermissionKey[] {
  const grants = new Set<PermissionKey>();
  for (const membership of membershipGrants(user)) {
    for (const key of membership.grants) grants.add(key);
  }
  return [...grants];
}

/** Unión de los accesos de las pertenencias que sí permiten escritura. */
export function writablePermissionsForUser(user: AppUser | null | undefined): PermissionKey[] {
  const grants = new Set<PermissionKey>();
  for (const membership of membershipGrants(user)) {
    if (membership.readOnly) continue;
    for (const key of membership.grants) grants.add(key);
  }
  return [...grants];
}

export function userCanWritePermission(user: AppUser | null | undefined, key: PermissionKey): boolean {
  if (!user) return false;
  if (user.active === false) return false;
  if (isAdminUser(user)) return true;
  if (key === 'users' || key === 'dashboard' || key === 'pagos') return false;
  return writablePermissionsForUser(user).includes(key);
}

/** Criterio compartido con el servidor: vendedor puro, sin gestión de pedidos. */
export function isSalespersonOnly(user: AppUser | null | undefined) {
  return userHasPermission(user, 'salesperson') && !userHasPermission(user, 'order_management');
}

// ── Formulario multi-perfil ──────────────────────────────────────────────────
// El editor de usuarios conserva un mapa de permisos por cada perfil asignado
// para que cambiar el perfil principal (o des/marcar un perfil) nunca pierda
// los accesos personalizados de otro perfil.

export type RolePermissionMap = Partial<Record<AppRole, PermissionKey[]>>;

/** Preset inicial de un perfil (admin siempre completo). */
export function presetPermissionsForRole(role: AppRole): PermissionKey[] {
  if (isAdminRole(role)) return [...ALL_PERMISSION_KEYS];
  return [...ROLE_PRESETS[role].permissions];
}

/**
 * Accesos mostrados para un perfil. Un mapa explícito (incluido uno vacío)
 * manda; sin entrada se usa el preset del perfil.
 */
export function grantsForRole(rolePermissions: RolePermissionMap, role: AppRole): PermissionKey[] {
  if (isAdminRole(role)) return [...ALL_PERMISSION_KEYS];
  if (role === 'vendedor') return [...ROLE_PRESETS.vendedor.permissions];
  const explicit = rolePermissions[role];
  return explicit ? [...explicit] : presetPermissionsForRole(role);
}

/** Perfil cuyos accesos se personalizan: el preferido si es editable, o el primero. */
export function pickPermissionEditingRole(roles: AppRole[], preferred?: AppRole): AppRole {
  const editable = roles.filter((role) => !isPermissionsLocked(role));
  if (preferred && editable.includes(preferred)) return preferred;
  return editable[0] ?? primaryRoleOf(roles);
}

type RoleFormState = {
  roles: AppRole[];
  rolePermissions: RolePermissionMap;
  editingRole: AppRole;
};

/**
 * Marca o desmarca un perfil. Añadir un perfil nuevo estrena su preset; los
 * grants personalizados se conservan aunque el perfil se retire (para
 * recuperarlos si se vuelve a marcar antes de guardar).
 */
export function toggleRoleAssignment(state: RoleFormState, role: AppRole): RoleFormState {
  const has = state.roles.includes(role);
  const roles = has ? state.roles.filter((item) => item !== role) : [...state.roles, role];
  if (roles.length === 0) return state;
  const rolePermissions = { ...state.rolePermissions };
  if (!has && !Object.prototype.hasOwnProperty.call(rolePermissions, role)) {
    rolePermissions[role] = presetPermissionsForRole(role);
  }
  return {
    roles,
    rolePermissions,
    editingRole: pickPermissionEditingRole(roles, state.editingRole),
  };
}

/** Mapa listo para el API: solo perfiles asignados, con sus grants efectivos. */
export function rolePermissionsPayload(
  roles: AppRole[],
  rolePermissions: RolePermissionMap,
): RolePermissionMap {
  const payload: RolePermissionMap = {};
  for (const role of roles) payload[role] = grantsForRole(rolePermissions, role);
  return payload;
}

/** Perfil principal determinista: mayor rango; empates según SELECTABLE_ROLES. */
export function primaryRoleOf(roles: readonly string[] | string | undefined): AppRole {
  const list = (Array.isArray(roles) ? roles : [roles]).filter((value): value is string => Boolean(value));
  const valid = [...new Set(list.map((value) => String(value).trim()).filter((value) => value in ROLE_PRESETS))];
  if (!valid.length) return 'operator';
  let best = valid[0];
  for (const role of valid) {
    const rank = roleRankOf(role as AppRole);
    const bestRank = roleRankOf(best as AppRole);
    if (rank > bestRank) best = role;
    else if (rank === bestRank) {
      const roleIndex = SELECTABLE_ROLES.indexOf(role as AppRole);
      const bestIndex = SELECTABLE_ROLES.indexOf(best as AppRole);
      if (roleIndex >= 0 && (bestIndex < 0 || roleIndex < bestIndex)) best = role;
    }
  }
  return best as AppRole;
}

function roleRankOf(role: AppRole) {
  return ROLE_RANK[role] ?? ROLE_RANK.operator;
}

export function pathPermission(pathname: string): PermissionKey | null {
  if (pathname.startsWith('/dashboard')) return 'dashboard';
  if (pathname.startsWith('/ventas')) return 'dashboard';
  if (pathname.startsWith('/pagos')) return 'pagos';
  if (pathname.startsWith('/mis-ventas')) return 'salesperson';
  if (pathname.startsWith('/envio-propio') || pathname.startsWith('/orders/envio')) return 'settings';
  if (pathname.startsWith('/orders')) return 'order_management';
  if (pathname.startsWith('/cancelados')) return 'order_management';
  if (pathname.startsWith('/bandeja')) return 'orders_inbox';
  if (pathname.startsWith('/pedidos')) return 'orders_inbox';
  if (pathname.startsWith('/scanner')) return 'orders_scanner';
  if (pathname.startsWith('/boletas')) return 'boletas';
  if (pathname.startsWith('/facturas')) return 'facturas';
  if (pathname.startsWith('/documentos') || pathname.startsWith('/individual-invoice')) return 'boletas';
  if (pathname.startsWith('/falabella-api') || pathname.startsWith('/workflow')) return 'falabella_sellers';
  if (pathname.startsWith('/productos')) return 'productos';
  if (pathname.startsWith('/descuentos-stock')) return 'productos';
  if (pathname.startsWith('/insumos')) return 'insumos';
  if (pathname.startsWith('/auto-emision')) return 'auto_emision';
  if (pathname.startsWith('/credit-notes/bulk')) return 'credit_notes_bulk';
  if (pathname.startsWith('/credit-notes')) return 'credit_notes_manage';
  if (pathname.startsWith('/companies')) return 'companies';
  if (pathname.startsWith('/settings')) return 'settings';
  if (pathname.startsWith('/users')) return 'users';
  return null;
}

export function firstAllowedPath(
  user: AppUser | null | undefined,
  isProd = import.meta.env.VITE_APP_ENV === 'production',
): string {
  for (const permission of PERMISSIONS) {
    if (permission.hiddenInProduction && isProd) continue;
    if (userHasPermission(user, permission.key)) return permission.path;
  }
  return '/settings';
}
