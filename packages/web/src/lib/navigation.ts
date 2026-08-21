import type { LucideIcon } from 'lucide-react';
import {
  Building2,
  ChartNoAxesCombined,
  FileMinus2,
  FileText,
  Inbox,
  ListOrdered,
  PackageMinus,
  PackageOpen,
  PackageCheck,
  PackageSearch,
  ReceiptText,
  ScanLine,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Shuffle,
  Users,
  Zap,
} from 'lucide-react';
import falabellaIcon from '../assets/falabella.png';
import type { PermissionKey } from './permissions';

export type NavItem = {
  to: string;
  icon: LucideIcon;
  img?: string;
  label: string;
  /** Los ítems solo para superadmin no dependen de un permiso del menú. */
  permission?: PermissionKey;
  description?: string;
  superadminOnly?: boolean;
  hiddenInProduction?: boolean;
};

export type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'ops',
    label: 'Operación',
    items: [
      { to: '/dashboard', icon: ChartNoAxesCombined, label: 'Dashboard', permission: 'dashboard' },
      { to: '/falabella-api', icon: ShoppingBag, img: falabellaIcon as string, label: 'Falabella', permission: 'falabella_sellers' },
      { to: '/productos', icon: PackageSearch, label: 'Productos', permission: 'productos', hiddenInProduction: true },
      { to: '/salidas', icon: PackageMinus, label: 'Salidas de hoy', permission: 'salidas' },
      { to: '/insumos', icon: PackageOpen, label: 'Insumos', permission: 'insumos' },
    ],
  },
  {
    id: 'orders',
    label: 'Pedidos',
    items: [
      { to: '/orders', icon: ListOrdered, label: 'Todos los pedidos', permission: 'order_management' },
      { to: '/pedidos', icon: Inbox, label: 'Bandeja Falabella', permission: 'orders_inbox' },
      { to: '/pedidos-ripley', icon: PackageCheck, label: 'Bandeja Ripley', permission: 'orders_inbox' },
      { to: '/scanner', icon: ScanLine, label: 'Preparación y escaneo', permission: 'orders_scanner' },
    ],
  },
  {
    id: 'documents',
    label: 'Comprobantes',
    items: [
      { to: '/boletas', icon: ReceiptText, label: 'Boletas', permission: 'boletas' },
      { to: '/facturas', icon: FileText, label: 'Facturas', permission: 'facturas' },
      { to: '/credit-notes', icon: FileMinus2, label: 'Notas de crédito', permission: 'credit_notes_manage' },
      { to: '/auto-emision', icon: Zap, label: 'Automatización', permission: 'auto_emision' },
      { to: '/credit-notes/bulk', icon: Shuffle, label: 'Anulación masiva', permission: 'credit_notes_bulk' },
    ],
  },
  {
    id: 'config',
    label: 'Configuración',
    items: [
      { to: '/companies', icon: Building2, label: 'Empresas', permission: 'companies' },
      { to: '/users', icon: Users, label: 'Usuarios', permission: 'users' },
      { to: '/settings', icon: Settings, label: 'Ajustes', permission: 'settings' },
      {
        to: '/system-config',
        icon: ShieldCheck,
        label: 'Sistema',
        superadminOnly: true,
        description: 'Flags operativos del ambiente. Visible solo para superadministradores.',
      },
    ],
  },
];

export function isNavItemActive(pathname: string, to: string) {
  const activePath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (to === '/credit-notes') return activePath === to;
  return activePath === to || activePath.startsWith(`${to}/`);
}

export function visibleNavigation(
  can: (permission: PermissionKey) => boolean,
  isProd = import.meta.env.VITE_APP_ENV === 'production',
  options: { isSuperadmin?: boolean } = {},
) {
  return NAV_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (isProd && item.hiddenInProduction) return false;
        if (item.superadminOnly) return options.isSuperadmin === true;
        if (!item.permission) return false;
        if (item.to === '/salidas') return can('salidas') || can('productos');
        return can(item.permission);
      }),
    }))
    .filter((group) => group.items.length > 0);
}
