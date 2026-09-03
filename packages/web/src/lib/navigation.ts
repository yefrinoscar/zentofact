import type { LucideIcon } from 'lucide-react';
import {
  Building2,
  ChartNoAxesCombined,
  CircleDollarSign,
  FileMinus2,
  FileText,
  Inbox,
  ListOrdered,
  PackageOpen,
  PackageSearch,
  ReceiptText,
  ScanLine,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Shuffle,
  TrendingDown,
  Users,
  Wallet,
  Zap,
} from 'lucide-react';
import falabellaIcon from '../assets/falabella.png';
import type { PermissionKey } from './permissions';
import { isNavItemActive, isNavItemVisible, mobileNavPathname } from './nav-path';

export { isNavItemActive, mobileNavPathname };

export type NavItem = {
  to: string;
  icon: LucideIcon;
  img?: string;
  label: string;
  /** Los ítems solo para superadmin no dependen de un permiso del menú. */
  permission?: PermissionKey;
  description?: string;
  adminOnly?: boolean;
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
      { to: '/pagos', icon: CircleDollarSign, label: 'Pagos', permission: 'pagos' },
      { to: '/falabella-api', icon: ShoppingBag, img: falabellaIcon as string, label: 'Falabella', permission: 'falabella_sellers' },
      { to: '/productos', icon: PackageSearch, label: 'Productos', permission: 'productos', hiddenInProduction: true },
      { to: '/descuentos-stock', icon: TrendingDown, label: 'Cola de descuentos', permission: 'productos', hiddenInProduction: true },
    ],
  },
  {
    id: 'orders',
    label: 'Pedidos',
    items: [
      { to: '/mis-ventas', icon: Wallet, label: 'Mis ventas', permission: 'salesperson' },
      { to: '/bandeja', icon: Inbox, label: 'Bandeja', permission: 'orders_inbox' },
      { to: '/orders', icon: ListOrdered, label: 'Todos los pedidos', permission: 'order_management' },
      { to: '/pedidos', icon: Inbox, label: 'Bandeja Falabella', permission: 'orders_inbox' },
      { to: '/scanner', icon: ScanLine, label: 'Preparación y escaneo', permission: 'orders_scanner' },
      { to: '/insumos', icon: PackageOpen, label: 'Insumos', permission: 'insumos' },
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

export function visibleNavigation(
  can: (permission: PermissionKey) => boolean,
  isProd = import.meta.env.VITE_APP_ENV === 'production',
  options: { isAdmin?: boolean; isSuperadmin?: boolean } = {},
) {
  return NAV_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => isNavItemVisible(item, can, isProd, options)),
    }))
    .filter((group) => group.items.length > 0);
}
