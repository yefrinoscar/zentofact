import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Building2,
  ChartNoAxesCombined,
  ChevronsUpDown,
  FileMinus2,
  FileText,
  Inbox,
  ListOrdered,
  LogOut,
  PackageSearch,
  PanelLeftClose,
  PanelLeftOpen,
  ReceiptText,
  ScanLine,
  Settings,
  ShoppingBag,
  Shuffle,
  Users,
  Zap,
} from 'lucide-react';
import { useAppStore } from '../stores/app';
import { authClient } from '../lib/authClient';
import api from '../lib/api';
import { clearClientStorageOnLogout, broadcastForceReauth } from '../lib/clearClientStorage';
import falabellaIcon from '../assets/falabella.png';
import webPackage from '../../package.json';
import { usePermissions } from '../hooks/usePermissions';
import type { PermissionKey } from '../lib/permissions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from './ui/sidebar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

type NavItem = {
  to: string;
  icon: typeof Settings;
  img?: string | null;
  label: string;
  permission: PermissionKey;
};

type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    id: 'ops',
    label: 'Operación',
    items: [
      { to: '/dashboard', icon: ChartNoAxesCombined, label: 'Dashboard', permission: 'dashboard' },
      { to: '/orders', icon: ListOrdered, label: 'Pedidos multicanal', permission: 'falabella' },
      { to: '/pedidos', icon: Inbox, label: 'Bandeja de pedidos', permission: 'falabella' },
      { to: '/scanner', icon: ScanLine, label: 'Escáner de armado', permission: 'falabella' },
      { to: '/falabella-api', icon: ShoppingBag, img: falabellaIcon as string, label: 'Falabella', permission: 'falabella' },
      { to: '/productos', icon: PackageSearch, label: 'Productos', permission: 'productos' },
    ],
  },
  {
    id: 'documents',
    label: 'Comprobantes',
    items: [
      { to: '/boletas', icon: ReceiptText, label: 'Boletas', permission: 'documentos' },
      { to: '/facturas', icon: FileText, label: 'Facturas', permission: 'documentos' },
      { to: '/credit-notes', icon: FileMinus2, label: 'Notas de crédito', permission: 'documentos' },
      { to: '/auto-emision', icon: Zap, label: 'Automatización', permission: 'auto_emision' },
      { to: '/credit-notes/bulk', icon: Shuffle, label: 'Anulación masiva', permission: 'credit_notes' },
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

const APP_VERSION = webPackage.version;

function runtimeEnvironment() {
  const env = (import.meta as any).env || {};
  const forcedSunat = String(env.VITE_SUNAT_ENV || '').trim().toLowerCase();
  const appEnv = env.PROD ? 'Producción' : 'Local';
  const sunatEnv = forcedSunat === 'produccion' ? 'SUNAT prod.' : forcedSunat === 'beta' ? 'SUNAT beta' : '';
  return sunatEnv ? `${appEnv} · ${sunatEnv}` : appEnv;
}

export default function Sidebar({ hideOnMobile = false }: { hideOnMobile?: boolean }) {
  const { pathname } = useLocation();
  const activePath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggle = useAppStore((s) => s.toggleSidebar);
  const { can, loading } = usePermissions();
  const isProd = Boolean((import.meta as any).env?.PROD);

  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (isProd && item.to === '/productos') return false;
        return can(item.permission);
      }),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <SidebarRoot collapsed={collapsed} className={hideOnMobile ? 'hidden md:flex' : undefined}>
      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? 'Expandir menú lateral' : 'Colapsar menú lateral'}
        title={collapsed ? 'Expandir menú lateral' : 'Colapsar menú lateral'}
        className="absolute -right-3 top-5 z-30 hidden size-7 place-items-center rounded-full border border-sidebar-border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground md:grid"
      >
        {collapsed ? <PanelLeftOpen className="size-3.5" /> : <PanelLeftClose className="size-3.5" />}
      </button>
      <SidebarHeader className="h-16 justify-center border-b border-sidebar-border/70">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" className="hover:bg-transparent">
              <Link to="/" title="ZentoFact">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sidebar-primary text-sm font-bold tracking-tight text-sidebar-primary-foreground">
                  Z
                </span>
                <span className="hidden min-w-0 flex-1 leading-tight md:grid md:group-data-[collapsed=true]/sidebar:hidden">
                  <span className="truncate font-semibold text-sidebar-foreground">ZentoFact</span>
                  <span className="truncate text-xs font-normal text-sidebar-foreground/50">Comprobantes SUNAT</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <TooltipProvider delayDuration={250}>
          {loading ? (
            <div className="space-y-2 px-4 py-3">
              <div className="h-8 animate-pulse rounded-lg bg-sidebar-accent" />
              <div className="h-8 animate-pulse rounded-lg bg-sidebar-accent" />
            </div>
          ) : (
            visibleGroups.map((group) => (
              <SidebarGroup key={group.id}>
                <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map(({ to, icon: Icon, img, label }) => {
                      const active = to === '/credit-notes'
                        ? activePath === to
                        : activePath === to || activePath.startsWith(to + '/');

                      return (
                        <SidebarMenuItem key={to}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <SidebarMenuButton asChild isActive={active}>
                                <Link to={to} title={label}>
                                  {img
                                    ? <img src={img} alt="" className="size-4 shrink-0 rounded-[3px]" />
                                    : <Icon />}
                                  <span className="hidden md:inline md:group-data-[collapsed=true]/sidebar:hidden">{label}</span>
                                </Link>
                              </SidebarMenuButton>
                            </TooltipTrigger>
                            <TooltipContent side="right" hidden={!collapsed}>{label}</TooltipContent>
                          </Tooltip>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))
          )}
        </TooltipProvider>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/70">
        <RuntimeVersion collapsed={collapsed} />
        <UserMenu collapsed={collapsed} />
      </SidebarFooter>
      <SidebarRail onClick={toggle} />
    </SidebarRoot>
  );
}

function RuntimeVersion({ collapsed }: { collapsed: boolean }) {
  const env = (import.meta as any).env || {};
  const label = env.PROD ? `v${APP_VERSION}` : `v${APP_VERSION} · ${runtimeEnvironment()}`;

  return (
    <p
      title={label}
      className={`mb-1 truncate px-2 text-[10px] font-medium text-sidebar-foreground/40 ${collapsed ? 'text-center' : 'hidden md:block'}`}
    >
      {collapsed ? `v${APP_VERSION.split('.')[0]}` : label}
    </p>
  );
}

function UserMenu({ collapsed }: { collapsed: boolean }) {
  const { data: session } = authClient.useSession();
  const { role } = usePermissions();
  const [signingOut, setSigningOut] = useState(false);
  const email = session?.user?.email || '';
  const name = session?.user?.name || email.split('@')[0] || 'Cuenta';
  const roleLabel = role === 'admin' ? 'Admin' : role === 'viewer' ? 'Consulta' : role === 'operator' ? 'Operador' : role;
  const initial = (name || email || 'Z').trim().charAt(0).toUpperCase();

  const logout = async () => {
    setSigningOut(true);
    try {
      try { await api.logoutAll(); } catch {}
      try { await authClient.signOut(); } catch {}
    } finally {
      clearClientStorageOnLogout();
      broadcastForceReauth('logout');
      window.location.reload();
    }
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sidebar-accent text-sm font-semibold text-sidebar-accent-foreground">
                {initial}
              </span>
              <span className="hidden min-w-0 flex-1 text-left leading-tight md:grid md:group-data-[collapsed=true]/sidebar:hidden">
                <span className="truncate font-medium text-sidebar-foreground">{name}</span>
                <span className="truncate text-xs font-normal text-sidebar-foreground/50">{roleLabel || email}</span>
              </span>
              <ChevronsUpDown className="ml-auto hidden text-sidebar-foreground/50 md:block md:group-data-[collapsed=true]/sidebar:hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side={collapsed ? 'right' : 'top'} align="end" className="min-w-56 rounded-xl">
            <DropdownMenuLabel className="p-2 font-normal">
              <div className="grid gap-0.5">
                <span className="truncate text-sm font-medium text-foreground">{name}</span>
                <span className="truncate text-xs text-muted-foreground">{email}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings"><Settings /> Ajustes y tema</Link>
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" disabled={signingOut} onSelect={logout}>
              <LogOut /> {signingOut ? 'Saliendo…' : 'Cerrar sesión'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
