import type { PermissionKey } from './permissions';

export function isNavItemActive(pathname: string, to: string) {
  const activePath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (to === '/credit-notes') return activePath === to;
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
