import type { LucideIcon } from 'lucide-react';
import {
  Building2,
  ChartNoAxesCombined,
  FileMinus2,
  FileText,
  Inbox,
  ListOrdered,
  PackageSearch,
  ReceiptText,
  ScanLine,
  Settings,
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
  permission: PermissionKey;
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
      { to: '/orders', icon: ListOrdered, label: 'Seguimiento multicanal', permission: 'order_management', hiddenInProduction: true },
      { to: '/productos', icon: PackageSearch, label: 'Productos', permission: 'productos' },
    ],
  },
  {
    id: 'orders',
    label: 'Pedidos',
    items: [
      { to: '/pedidos', icon: Inbox, label: 'Recepción de pedidos', permission: 'orders_inbox' },
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
    ],
  },
];

export function isNavItemActive(pathname: string, to: string) {
  const activePath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (to === '/credit-notes') return activePath === to;
  return activePath === to || activePath.startsWith(`${to}/`);
}

export function visibleNavigation(can: (permission: PermissionKey) => boolean, isProd: boolean) {
  return NAV_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !(isProd && item.hiddenInProduction) && can(item.permission)),
    }))
    .filter((group) => group.items.length > 0);
}
