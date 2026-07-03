import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  FileText,
  FileMinus2,
  ShoppingBag,
  ClipboardList,
  Settings,
  ChevronLeft,
  MoreVertical,
  LogOut,
  Zap,
} from 'lucide-react';
import { useAppStore } from '../stores/app';
import { authClient } from '../lib/authClient';
import falabellaIcon from '../assets/falabella.png';

const navItems = [
  { to: '/individual-invoice', icon: FileText, img: null, label: 'Emisión individual' },
  { to: '/falabella-api', icon: ShoppingBag, img: falabellaIcon as string | null, label: 'Falabella' },
  { to: '/auto-emision', icon: Zap, img: null, label: 'Automatización' },
  { to: '/credit-notes', icon: FileMinus2, img: null, label: 'Notas de crédito' },
  { to: '/summaries', icon: ClipboardList, img: null, label: 'Resúmenes' },
  { to: '/settings', icon: Settings, img: null, label: 'Ajustes' },
];

export default function Sidebar() {
  const { pathname } = useLocation();
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggle = useAppStore((s) => s.toggleSidebar);

  return (
    <aside
      className={`flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ${
        collapsed ? 'w-[76px]' : 'w-64'
      }`}
    >
      {/* Marca — h-20 para cuadrar con el header del contenido */}
      <div className="flex h-20 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-4">
        {collapsed ? (
          // Colapsado: solo el logo Z (clic para expandir)
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
              <span className="truncate text-[15px] font-semibold tracking-tight">ZentoFact</span>
            </div>
            <button
              onClick={toggle}
              aria-label="Colapsar menú"
              className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {!collapsed && (
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Menú
          </p>
        )}
        {navItems.map(({ to, icon: Icon, img, label }) => {
          const active = pathname === to;
          const iconNode = img
            ? <img src={img} alt="" className="h-[18px] w-[18px] shrink-0 rounded-[4px]" />
            : <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? '' : 'text-muted-foreground group-hover:text-sidebar-accent-foreground'}`} />;

          return (
            <Link
              key={to}
              to={to}
              title={collapsed ? label : undefined}
              className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                collapsed ? 'justify-center' : ''
              } ${
                active
                  ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              }`}
            >
              {active && !collapsed && (
                <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-sidebar-primary" />
              )}
              {iconNode}
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>

      <UserFooter collapsed={collapsed} />
    </aside>
  );
}

function UserFooter({ collapsed }: { collapsed: boolean }) {
  const { data: session } = authClient.useSession();
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
  const initial = (name || email || 'Z').trim().charAt(0).toUpperCase();

  const logout = async () => {
    setSigningOut(true);
    try {
      await authClient.signOut();
    } finally {
      window.location.reload();
    }
  };

  return (
    <div ref={ref} className="relative border-t border-sidebar-border p-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2.5 rounded-xl p-1.5 text-left transition-colors hover:bg-sidebar-accent ${
          collapsed ? 'justify-center' : ''
        }`}
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground">
          {initial}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-sidebar-foreground">{name}</span>
              <span className="block truncate text-xs text-muted-foreground">{email}</span>
            </span>
            <MoreVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
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
            </div>
          )}
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
