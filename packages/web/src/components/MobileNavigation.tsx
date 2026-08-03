import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronsUpDown, LayoutGrid, LogOut, Settings } from 'lucide-react';
import { authClient } from '../lib/authClient';
import api from '../lib/api';
import { broadcastForceReauth, clearClientStorageOnLogout } from '../lib/clearClientStorage';
import { isNavItemActive, visibleNavigation } from '../lib/navigation';
import { ROLE_PRESETS, normalizeRole } from '../lib/permissions';
import { usePermissions } from '../hooks/usePermissions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

export function MobileTopNavigation({ title }: { title: string }) {
  const { pathname } = useLocation();
  const { can } = usePermissions();
  const isProd = Boolean((import.meta as any).env?.PROD);
  const groups = visibleNavigation(can, isProd);
  const activeGroup = groups.find((group) => group.items.some((item) => isNavItemActive(pathname, item.to)));
  const onMenu = pathname === '/menu';

  return (
    <header className="shrink-0 border-b border-border/80 bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
      <div className="flex h-16 items-center gap-2 px-3">
        <Link
          to="/menu"
          className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors ${onMenu ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground active:bg-muted/70'}`}
          aria-label="Abrir menú principal"
        >
          <LayoutGrid className="size-5" />
          <span>Menú</span>
        </Link>

        {onMenu ? (
          <div className="min-w-0 flex-1 px-1">
            <p className="truncate text-sm font-semibold">ZentoFact</p>
            <p className="truncate text-xs text-muted-foreground">Selecciona un módulo</p>
          </div>
        ) : activeGroup ? (
          <nav className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label={`Navegación de ${activeGroup.label}`}>
            {activeGroup.items.map(({ to, label, icon: Icon, img }) => {
              const active = isNavItemActive(pathname, to);
              return (
                <Link
                  key={to}
                  to={to}
                  aria-current={active ? 'page' : undefined}
                  className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors ${active ? 'bg-primary/10 text-primary' : 'text-muted-foreground active:bg-muted'}`}
                >
                  {img ? <img src={img} alt="" className="size-5 rounded" /> : <Icon className="size-5" />}
                  <span>{label}</span>
                </Link>
              );
            })}
          </nav>
        ) : (
          <p className="min-w-0 flex-1 truncate px-2 text-sm font-semibold">{title}</p>
        )}

        <MobileAccountMenu />
      </div>
    </header>
  );
}

function MobileAccountMenu() {
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-sm font-semibold" aria-label="Abrir opciones de la cuenta">
          {initial}
          <ChevronsUpDown className="ml-0.5 size-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-60 rounded-xl">
        <DropdownMenuLabel className="p-2 font-normal">
          <div className="grid gap-0.5">
            <span className="truncate text-sm font-medium text-foreground">{name}</span>
            <span className="truncate text-xs text-muted-foreground">{roleLabel} · {email}</span>
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
  );
}
