import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ChevronsUpDown,
  LogOut,
  Settings,
} from 'lucide-react';
import { useAppStore } from '../stores/app';
import { authClient } from '../lib/authClient';
import api from '../lib/api';
import { clearClientStorageOnLogout, broadcastForceReauth } from '../lib/clearClientStorage';
import webPackage from '../../package.json';
import { usePermissions } from '../hooks/usePermissions';
import { ROLE_PRESETS, normalizeRole } from '../lib/permissions';
import { isNavItemActive, visibleNavigation } from '../lib/navigation';
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

const APP_VERSION = webPackage.version;

function runtimeEnvironment() {
  const env = (import.meta as any).env || {};
  const forcedSunat = String(env.VITE_SUNAT_ENV || '').trim().toLowerCase();
  const appEnv = env.VITE_APP_ENV === 'production' ? 'Producción' : env.DEV ? 'Local' : 'Desarrollo';
  const sunatEnv = forcedSunat === 'produccion' ? 'SUNAT prod.' : forcedSunat === 'beta' ? 'SUNAT beta' : '';
  return sunatEnv ? `${appEnv} · ${sunatEnv}` : appEnv;
}

export default function Sidebar({ hideOnMobile = false }: { hideOnMobile?: boolean }) {
  const { pathname } = useLocation();
  const activePath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggle = useAppStore((s) => s.toggleSidebar);
  const { can, loading } = usePermissions();

  const visibleGroups = visibleNavigation(can);

  return (
    <SidebarRoot collapsed={collapsed} className={hideOnMobile ? 'hidden md:flex' : undefined}>
      <SidebarHeader className="h-16 justify-center border-b border-sidebar-border/70">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" className="hover:bg-transparent">
              <Link to="/" aria-label="ZentoFact">
                <ZentoFactMark />
                <span className="hidden min-w-0 flex-1 leading-tight md:grid md:group-data-[collapsed=true]/sidebar:hidden">
                  <span className="truncate font-semibold text-sidebar-foreground">ZentoFact</span>
                  <span className="truncate text-xs font-normal text-sidebar-foreground/50">Ventas y facturación</span>
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
                      const active = isNavItemActive(activePath, to);

                      return (
                        <SidebarMenuItem key={to}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <SidebarMenuButton asChild isActive={active}>
                                <Link to={to}>
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

function ZentoFactMark() {
  return (
    <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-md bg-white p-0.5" aria-hidden="true">
      <svg viewBox="0 0 512 512" className="size-full" role="img">
        <path d="M32 72h284v96L152 376h164v104H32v-96l164-208H32z" fill="#132238" />
        <path d="M340 72h140v104h-56v48h44v100h-44v156h-84z" fill="#2864F0" />
      </svg>
    </span>
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
  const { role, can } = usePermissions();
  const [signingOut, setSigningOut] = useState(false);
  const email = session?.user?.email || '';
  const name = session?.user?.name || email.split('@')[0] || 'Cuenta';
  const roleLabel = ROLE_PRESETS[normalizeRole(role)].label;
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
            {can('settings') && (
              <DropdownMenuItem asChild>
                <Link to="/settings"><Settings /> Ajustes y tema</Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem variant="destructive" disabled={signingOut} onSelect={logout}>
              <LogOut /> {signingOut ? 'Saliendo…' : 'Cerrar sesión'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
