import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Home,
  Building2,
  PlusCircle,
  History,
  ShoppingBag,
  ClipboardList,
  Settings,
  ChevronLeft,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { useAppStore } from '../stores/app';
import api from '../lib/api';

const navItems = [
  { to: '/', icon: Home, label: 'Dashboard' },
  { to: '/companies', icon: Building2, label: 'Empresas' },
  { to: '/workflow', icon: PlusCircle, label: 'Nueva Emisión' },
  { to: '/history', icon: History, label: 'Historial' },
  { to: '/falabella-api', icon: ShoppingBag, label: 'Falabella API' },
  { to: '/summaries', icon: ClipboardList, label: 'Resúmenes' },
  { to: '/settings', icon: Settings, label: 'Ajustes' },
];

export default function Sidebar() {
  const { pathname } = useLocation();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggle = useAppStore((s) => s.toggleSidebar);
  const [companyCount, setCompanyCount] = useState<number | null>(null);
  const [companyLoadFailed, setCompanyLoadFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    setCompanyCount(null);
    api.listCompanies()
      .then((list: any[]) => {
        if (mounted) {
          setCompanyCount(Array.isArray(list) ? list.length : 0);
          setCompanyLoadFailed(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setCompanyCount(null);
          setCompanyLoadFailed(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, [pathname]);

  const workflowEnabled = useMemo(
    () => (companyCount ?? 0) > 0 && !!activeCompanyId,
    [companyCount, activeCompanyId],
  );

  const workflowHint =
    companyLoadFailed
      ? 'No se pudieron cargar las empresas.'
      : companyCount === null
      ? 'Cargando empresas...'
      : companyCount === 0
      ? 'Primero crea una empresa en Empresas.'
      : 'Selecciona una empresa en Empresas para habilitar emisión.';

  return (
    <aside
      className={`flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-200 ${
        collapsed ? 'w-[74px]' : 'w-72'
      }`}
    >
      <div className="border-b border-sidebar-border px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          {!collapsed && (
            <div>
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Sistema</p>
              <h2 className="text-sm font-semibold tracking-wide">BOLETAS SUNAT</h2>
            </div>
          )}

          <button
            onClick={toggle}
            className="rounded-md border border-sidebar-border p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <ChevronLeft className={`h-4 w-4 transition-transform ${collapsed ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {navItems.map(({ to, icon: Icon, label }) => {
          const active = pathname === to;
          const isWorkflow = to === '/workflow';
          const disabled = isWorkflow && !workflowEnabled;

          const itemClass = `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
            active
              ? 'bg-sidebar-primary text-sidebar-primary-foreground'
              : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
          } ${disabled ? 'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground' : ''}`;

          if (disabled) {
            return (
              <div key={to} title={workflowHint} className={itemClass}>
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span>{label}</span>}
              </div>
            );
          }

          return (
            <Link key={to} to={to} className={itemClass}>
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{label}</span>}
            </Link>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="space-y-2 border-t border-sidebar-border p-4 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground">
            {workflowEnabled ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
            )}
            <span>{workflowEnabled ? 'Workflow habilitado' : 'Workflow bloqueado'}</span>
          </div>
          {!workflowEnabled && <p className="text-muted-foreground">{workflowHint}</p>}
        </div>
      )}
    </aside>
  );
}
