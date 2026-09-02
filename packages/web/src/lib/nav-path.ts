import type { PermissionKey } from './permissions';

export function isNavItemActive(pathname: string, to: string) {
  const activePath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (to === '/credit-notes') return activePath === to;
  if (to === '/orders') {
    return activePath === to || activePath === '/orders/nueva' || activePath.startsWith('/orders/nueva/');
  }
  return activePath === to || activePath.startsWith(`${to}/`);
}

/** For vendedor-only users, Nueva venta stays under Mis ventas in mobile chrome. */
export function mobileNavPathname(
  pathname: string,
  can: (permission: PermissionKey) => boolean,
) {
  const activePath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (activePath === '/orders/nueva') {
    if (can('salesperson') && !can('order_management')) return '/mis-ventas';
  }
  return activePath;
}

export type NavVisibilityItem = {
  to: string;
  permission?: PermissionKey;
  adminOnly?: boolean;
  superadminOnly?: boolean;
  hiddenInProduction?: boolean;
};

export function isNavItemVisible(
  item: NavVisibilityItem,
  can: (permission: PermissionKey) => boolean,
  isProd = false,
  options: { isAdmin?: boolean; isSuperadmin?: boolean } = {},
) {
  if (isProd && item.hiddenInProduction) return false;
  if (item.adminOnly) return options.isAdmin === true || options.isSuperadmin === true;
  if (item.superadminOnly) return options.isSuperadmin === true;
  if (!item.permission) return false;
  return can(item.permission);
}
