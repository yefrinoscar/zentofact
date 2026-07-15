import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  FileMinus2,
  ShoppingBag,
  Settings,
  ChevronLeft,
  MoreVertical,
  LogOut,
  PackageSearch,
  Zap,
  ReceiptText,
  Users,
  Building2,
  ChartNoAxesCombined,
  Inbox,
} from 'lucide-react';
import { useAppStore } from '../stores/app';
import { authClient } from '../lib/authClient';
import api from '../lib/api';
import { clearClientStorageOnLogout, broadcastForceReauth } from '../lib/clearClientStorage';
import falabellaIcon from '../assets/falabella.png';
import webPackage from '../../package.json';
import { usePermissions } from '../hooks/usePermissions';
import type { PermissionKey } from '../lib/permissions';

type NavItem = {
  to: string;
  icon: typeof Settings;
  img?: string | null;
  label: string;
  permission: PermissionKey;
};

const navItems: NavItem[] = [
  { to: '/dashboard', icon: ChartNoAxesCombined, label: 'Dashboard', permission: 'dashboard' },
  { to: '/pedidos', icon: Inbox, label: 'Bandeja de pedidos', permission: 'falabella' },
  { to: '/documentos', icon: ReceiptText, label: 'Documentos', permission: 'documentos' },
  { to: '/falabella-api', icon: ShoppingBag, img: falabellaIcon as string, label: 'Falabella', permission: 'falabella' },
  { to: '/productos', icon: PackageSearch, label: 'Productos', permission: 'productos' },
  { to: '/auto-emision', icon: Zap, label: 'Automatización', permission: 'auto_emision' },
  { to: '/credit-notes', icon: FileMinus2, label: 'Notas de crédito', permission: 'credit_notes' },
  { to: '/companies', icon: Building2, label: 'Empresas', permission: 'companies' },
  { to: '/users', icon: Users, label: 'Usuarios', permission: 'users' },
  { to: '/settings', icon: Settings, label: 'Ajustes', permission: 'settings' },
];

const APP_VERSION = webPackage.version;

function runtimeEnvironment() {
  const env = (import.meta as any).env || {};
  const forcedSunat = String(env.VITE_SUNAT_ENV || '').trim().toLowerCase();
  const appEnv = env.PROD ? 'Producción' : 'Local';
  const sunatEnv = forcedSunat === 'produccion' ? 'SUNAT prod.' : forcedSunat === 'beta' ? 'SUNAT beta' : '';
  return sunatEnv ? `${appEnv} · ${sunatEnv}` : appEnv;
}

export default function Sidebar() {
  const { pathname } = useLocation();
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggle = useAppStore((s) => s.toggleSidebar);
  const { can, loading } = usePermissions();

  const visibleItems = navItems.filter((item) => can(item.permission));

  return (
    <aside
      className={`flex h-full w-[68px] min-w-[68px] max-w-[68px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ${
        collapsed ? 'md:w-[76px] md:min-w-[76px] md:max-w-[76px]' : 'md:w-64 md:min-w-64 md:max-w-64'
      }`}
    >
      <div className="flex h-20 shrink-0 items-center justify-center gap-2.5 border-b border-sidebar-border px-2 md:justify-start md:px-4">
        {collapsed ? (
          <button
            onClick={toggle}
            aria-label="Expandir menú"
            title="Expandir menú"
            className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-sidebar-primary text-base font-black tracking-tighter text-sidebar-primary-foreground shadow-sm transition-transform hover:scale-105"
          >
            Z
          </button>
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sidebar-primary text-sm font-black tracking-tighter text-sidebar-primary-foreground shadow-sm">
                Z
              </span>
              <span className="hidden truncate text-[15px] font-semibold tracking-tight md:block">ZentoFact</span>
            </div>
            <button
              onClick={toggle}
              aria-label="Colapsar menú"
              className="ml-auto hidden h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground md:grid"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {!collapsed && (
          <p className="hidden px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 md:block">
            Menú
          </p>
        )}
        {loading ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">Cargando…</p>
        ) : (
          visibleItems.map(({ to, icon: Icon, img, label }) => {
            const active = pathname === to || (to !== '/' && pathname.startsWith(to + '/'));
            const iconNode = img
              ? <img src={img} alt="" className="h-[18px] w-[18px] shrink-0 rounded-[4px]" />
              : <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? '' : 'text-muted-foreground group-hover:text-sidebar-accent-foreground'}`} />;

            return (
              <Link
                key={to}
                to={to}
                title={label}
                className={`group relative flex items-center justify-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                  collapsed ? 'md:justify-center' : 'md:justify-start'
                } ${
                  active
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                }`}
              >
                {active && !collapsed && (
                  <span className="absolute -left-3 top-1/2 hidden h-5 w-1 -translate-y-1/2 rounded-r-full bg-sidebar-primary md:block" />
                )}
                {iconNode}
                {!collapsed && <span className="hidden truncate md:inline">{label}</span>}
              </Link>
            );
          })
        )}
      </nav>

      <RuntimeFooter collapsed={collapsed} />
      <UserFooter collapsed={collapsed} />
    </aside>
  );
}

function RuntimeFooter({ collapsed }: { collapsed: boolean }) {
  const env = (import.meta as any).env || {};
  const isProd = Boolean(env.PROD);
  const label = isProd ? `v${APP_VERSION}` : `v${APP_VERSION} · ${runtimeEnvironment()}`;

  if (collapsed) {
    return (
      <div className="border-t border-sidebar-border px-3 py-2 text-center">
        <span title={label} className="text-[10px] font-medium text-muted-foreground">
          v{APP_VERSION.split('.')[0]}
        </span>
      </div>
    );
  }

  return (
    <div className="border-t border-sidebar-border px-4 py-2">
      <p className="hidden truncate text-[11px] font-medium text-muted-foreground md:block">
        {label}
      </p>
      <p className="text-center text-[10px] font-medium text-muted-foreground md:hidden">v{APP_VERSION.split('.')[0]}</p>
    </div>
  );
}

function UserFooter({ collapsed }: { collapsed: boolean }) {
  const { data: session } = authClient.useSession();
  const { role } = usePermissions();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const email = session?.user?.email || '';
  const name = session?.user?.name || email.split('@')[0] || 'Cuenta';
  const roleLabel = role === 'admin' ? 'Admin' : role === 'viewer' ? 'Consulta' : role === 'operator' ? 'Operador' : role;
  const initial = (name || email || 'Z').trim().charAt(0).toUpperCase();

  const logout = async () => {
    setSigningOut(true);
    try {
      // 1) Revoca TODAS las sesiones del usuario en el servidor.
      //    Otros dispositivos reciben 401 y limpian su propio localStorage.
      try {
        await api.logoutAll();
      } catch {
        // Si la sesión ya expiró, seguimos limpiando cliente.
      }
      // 2) Limpia cookie de Better Auth en este navegador.
      try {
        await authClient.signOut();
      } catch {
        // ignore
      }
    } finally {
      // 3) Limpia localStorage/sessionStorage de ESTA pestaña y avisa a las demás.
      clearClientStorageOnLogout();
      broadcastForceReauth('logout');
      // 4) Recarga → pantalla de login.
      window.location.reload();
    }
  };

  return (
    <div ref={ref} className="relative border-t border-sidebar-border p-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-center gap-2.5 rounded-xl p-1.5 text-left transition-colors hover:bg-sidebar-accent ${
          collapsed ? '' : 'md:justify-start'
        }`}
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground">
          {initial}
        </span>
        {!collapsed && (
          <>
            <span className="hidden min-w-0 flex-1 md:block">
              <span className="block truncate text-sm font-medium text-sidebar-foreground">{name}</span>
              <span className="block truncate text-xs text-muted-foreground">{roleLabel ? `${roleLabel} · ${email}` : email}</span>
            </span>
            <MoreVertical className="hidden h-4 w-4 shrink-0 text-muted-foreground md:block" />
          </>
        )}
      </button>

      {open && (
        <div
          className={`absolute bottom-[calc(100%-0.25rem)] z-50 min-w-[190px] overflow-hidden rounded-xl border border-border bg-card p-1 shadow-lg ${
            collapsed ? 'left-3' : 'left-3 right-3'
          }`}
        >
          {!collapsed && (
            <div className="border-b border-border px-3 py-2">
              <p className="truncate text-sm font-medium text-foreground">{name}</p>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
              {roleLabel && <p className="mt-1 truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{roleLabel}</p>}
            </div>
          )}
          <Link
            to="/settings"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            <Settings className="h-4 w-4" />
            Ajustes y tema
          </Link>
          <button
            onClick={logout}
            disabled={signingOut}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60"
          >
            <LogOut className="h-4 w-4" />
            {signingOut ? 'Saliendo…' : 'Cerrar sesión'}
          </button>
        </div>
      )}
    </div>
  );
}
