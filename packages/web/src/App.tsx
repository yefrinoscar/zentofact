import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import AuthGate from './components/AuthGate';
import Companies from './routes/Companies';
import CreditNotes from './routes/CreditNotes';
import Settings from './routes/Settings';
import UsersPage from './routes/Users';
import FalabellaApi from './routes/FalabellaApi';
import Productos from './routes/Productos';
import IndividualInvoice from './routes/IndividualInvoice';
import AutoEmision from './routes/AutoEmision';
import Documentos from './routes/Documentos';
import Pedidos from './routes/Pedidos';
import { useAppStore } from './stores/app';
import api from './lib/api';
import { usePermissions } from './hooks/usePermissions';
import { firstAllowedPath, pathPermission, userHasPermission } from './lib/permissions';

const Dashboard = lazy(() => import('./routes/Dashboard'));

const routeMeta: Record<string, { title: string; subtitle: string }> = {
  '/': {
    title: 'Panel General',
    subtitle: 'Resumen operativo y acceso rápido a emisión y control.',
  },
  '/dashboard': {
    title: 'Dashboard',
    subtitle: 'Comportamiento financiero y rendimiento de todas tus tiendas.',
  },
  '/pedidos': {
    title: 'Bandeja de pedidos',
    subtitle: 'Qué debes despachar ahora y cuánto tiempo tienes para entregarlo.',
  },
  '/companies': {
    title: 'Empresas',
    subtitle: 'Configura empresas, credenciales y certificados de emisión.',
  },
  '/credit-notes': {
    title: 'Notas de Crédito',
    subtitle: 'Anula boletas por mes y empresa emitiendo notas de crédito, individuales o en grupo.',
  },
  '/falabella-api': {
    title: 'Gestor de Sellers',
    subtitle: 'Consulta órdenes por empresa usando las credenciales Seller API guardadas.',
  },
  '/productos': {
    title: 'Productos',
    subtitle: 'Consulta productos publicados en Falabella por seller, SKU y estado.',
  },
  '/auto-emision': {
    title: 'Automatización',
    subtitle: 'Boletas en piloto automático desde las órdenes de Falabella.',
  },
  '/documentos': {
    title: 'Documentos',
    subtitle: 'Boletas y facturas emitidas a SUNAT. Filtra, descarga su PDF o emite una nueva.',
  },
  '/documentos/nuevo': {
    title: 'Nuevo documento',
    subtitle: 'Crea y emite una boleta o factura a SUNAT.',
  },
  '/users': {
    title: 'Usuarios',
    subtitle: 'Administra cuentas, roles y permisos de cada módulo del menú.',
  },
  '/settings': {
    title: 'Ajustes',
    subtitle: 'Configura empresas y el tema visual de la aplicación.',
  },
};

function RequirePermission({
  permission,
  user,
  loading,
  can,
  children,
}: {
  permission?: ReturnType<typeof pathPermission>;
  user: ReturnType<typeof usePermissions>['user'];
  loading: boolean;
  can: ReturnType<typeof usePermissions>['can'];
  children: React.ReactNode;
}) {
  // La sesión ya fue validada por AuthGate. Mientras llega el perfil completo,
  // dejamos que la ruta pinte su propio skeleton para evitar loaders sucesivos.
  if (loading) return <>{children}</>;
  if (!permission) return <>{children}</>;
  if (!can(permission)) {
    return <Navigate to={firstAllowedPath(user)} replace />;
  }
  return <>{children}</>;
}

function HomeRedirect({ user, loading }: Pick<ReturnType<typeof usePermissions>, 'user' | 'loading'>) {
  if (loading) return null;
  return <Navigate to={firstAllowedPath(user)} replace />;
}

function AppLayout() {
  const { pathname } = useLocation();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const setActiveCompanyId = useAppStore((s) => s.setActiveCompanyId);
  const { user, loading, can } = usePermissions();

  useEffect(() => {
    if (activeCompanyId) return;

    let mounted = true;

    api.getActiveCompanyId().then((id: number | null) => {
      if (!mounted) return;
      setActiveCompanyId(id);
    });

    return () => {
      mounted = false;
    };
  }, [activeCompanyId, setActiveCompanyId]);

  // Si el usuario cae en una ruta sin permiso (bookmark), redirigir.
  useEffect(() => {
    if (loading || !user) return;
    const perm = pathPermission(pathname);
    if (perm && !userHasPermission(user, perm)) {
      // handled by RequirePermission on routes; keep as safety no-op
    }
  }, [pathname, user, loading]);

  const currentRoute = routeMeta[pathname] || routeMeta['/'];
  const permissionState = { user, loading, can };

  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-20 items-center border-b border-border/80 bg-background/90 px-6 backdrop-blur">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-6">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold text-foreground">{currentRoute.title}</h1>
              <p className="truncate text-sm text-muted-foreground">{currentRoute.subtitle}</p>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6 lg:p-8">
          <div className="mx-auto w-full max-w-7xl">
            <Routes>
              <Route path="/" element={<HomeRedirect user={user} loading={loading} />} />
              <Route path="/dashboard" element={<RequirePermission permission="dashboard" {...permissionState}><Suspense fallback={<div className="h-80 animate-pulse rounded-2xl bg-muted" />}><Dashboard /></Suspense></RequirePermission>} />
              <Route path="/pedidos" element={<RequirePermission permission="falabella" {...permissionState}><Pedidos /></RequirePermission>} />
              <Route path="/companies" element={<RequirePermission permission="companies" {...permissionState}><Companies /></RequirePermission>} />
              <Route path="/workflow" element={<Navigate to="/falabella-api" replace />} />
              <Route path="/credit-notes" element={<RequirePermission permission="credit_notes" {...permissionState}><CreditNotes /></RequirePermission>} />
              <Route path="/falabella-api" element={<RequirePermission permission="falabella" {...permissionState}><FalabellaApi /></RequirePermission>} />
              <Route path="/productos" element={<RequirePermission permission="productos" {...permissionState}><Productos /></RequirePermission>} />
              <Route path="/auto-emision" element={<RequirePermission permission="auto_emision" {...permissionState}><AutoEmision /></RequirePermission>} />
              <Route path="/documentos" element={<RequirePermission permission="documentos" {...permissionState}><Documentos /></RequirePermission>} />
              <Route path="/documentos/nuevo" element={<RequirePermission permission="documentos" {...permissionState}><IndividualInvoice /></RequirePermission>} />
              <Route path="/individual-invoice" element={<Navigate to="/documentos/nuevo" replace />} />
              <Route path="/users" element={<RequirePermission permission="users" {...permissionState}><UsersPage /></RequirePermission>} />
              <Route path="/settings" element={<RequirePermission permission="settings" {...permissionState}><Settings /></RequirePermission>} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AuthGate>
        <AppLayout />
      </AuthGate>
    </HashRouter>
  );
}
