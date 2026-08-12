import { lazy, Suspense, useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import { MobileTopNavigation } from './components/MobileNavigation';
import AuthGate from './components/AuthGate';
import Companies from './routes/Companies';
import CreditNotes from './routes/CreditNotes';
import CreditNotesList from './routes/CreditNotesList';
import Settings from './routes/Settings';
import UsersPage from './routes/Users';
import FalabellaApi from './routes/FalabellaApi';
import Productos from './routes/Productos';
import IndividualInvoice from './routes/IndividualInvoice';
import AutoEmision from './routes/AutoEmision';
import Documentos from './routes/Documentos';
import Pedidos from './routes/Pedidos';
import PedidosMulticanal from './routes/PedidosMulticanal';
import MobileMenu from './routes/MobileMenu';
import { useAppStore } from './stores/app';
import api from './lib/api';
import { usePermissions } from './hooks/usePermissions';
import { firstAllowedPath, pathPermission } from './lib/permissions';
import { Button } from './components/ui/button';
import { PanelLeft } from 'lucide-react';
import { documentDateRangeForLastDays } from './lib/documentDateRange';

const Dashboard = lazy(() => import('./routes/Dashboard'));
const ScannerArmado = lazy(() => import('./routes/ScannerArmado'));

const routeMeta: Record<string, { title: string; subtitle: string }> = {
  '/': {
    title: 'Panel General',
    subtitle: 'Resumen operativo y acceso rápido a emisión y control.',
  },
  '/dashboard': {
    title: 'Dashboard',
    subtitle: 'Comportamiento financiero y rendimiento de todas tus tiendas.',
  },
  '/menu': {
    title: 'Menú',
    subtitle: 'Selecciona el módulo que necesitas usar.',
  },
  '/pedidos': {
    title: 'Recepción de pedidos',
    subtitle: 'Qué debes despachar ahora y cuánto tiempo tienes para entregarlo.',
  },
  '/orders': {
    title: 'Seguimiento multicanal',
    subtitle: 'Seguimiento unificado de pedidos, comprobantes y entregas por canal.',
  },
  '/scanner': {
    title: 'Preparación y escaneo',
    subtitle: 'Escanea una etiqueta y revisa el contenido exacto de cada bulto.',
  },
  '/companies': {
    title: 'Empresas',
    subtitle: 'Configura empresas, credenciales y certificados de emisión.',
  },
  '/credit-notes': {
    title: 'Notas de crédito',
    subtitle: 'Consulta notas de crédito emitidas (anulación de boletas).',
  },
  '/credit-notes/bulk': {
    title: 'Anulación masiva',
    subtitle: 'Anula boletas por mes y empresa emitiendo NC en lote.',
  },
  '/falabella-api': {
    title: 'Gestor de Sellers',
    subtitle: 'Consulta órdenes por empresa usando las credenciales Seller API guardadas.',
  },
  '/productos': {
    title: 'Catálogo de productos',
    subtitle: 'Productos, stock y publicaciones de cada empresa.',
  },
  '/auto-emision': {
    title: 'Automatización',
    subtitle: 'Boletas en piloto automático desde las órdenes de Falabella.',
  },
  '/boletas': {
    title: 'Boletas',
    subtitle: 'Gestiona las boletas emitidas y su estado en SUNAT.',
  },
  '/boletas/new': {
    title: 'Nueva boleta',
    subtitle: 'Emite una boleta electrónica a SUNAT.',
  },
  '/facturas': {
    title: 'Facturas',
    subtitle: 'Gestiona las facturas emitidas y su estado en SUNAT.',
  },
  '/facturas/new': {
    title: 'Nueva factura',
    subtitle: 'Emite una factura electrónica a SUNAT.',
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
  isMobile,
  children,
}: {
  permission?: ReturnType<typeof pathPermission>;
  user: ReturnType<typeof usePermissions>['user'];
  loading: boolean;
  can: ReturnType<typeof usePermissions>['can'];
  isMobile: boolean;
  children: React.ReactNode;
}) {
  // La sesión ya fue validada por AuthGate. Mientras llega el perfil completo,
  // dejamos que la ruta pinte su propio skeleton para evitar loaders sucesivos.
  if (loading) return <>{children}</>;
  if (!permission) return <>{children}</>;
  if (!can(permission)) {
    return <Navigate to={isMobile ? '/menu' : firstAllowedPath(user)} replace />;
  }
  return <>{children}</>;
}

function HomeRedirect({ user, loading, isMobile }: Pick<ReturnType<typeof usePermissions>, 'user' | 'loading'> & { isMobile: boolean }) {
  if (loading) return null;
  return <Navigate to={isMobile ? '/menu' : firstAllowedPath(user)} replace />;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isMobile;
}

function LegacyDocumentsRedirect() {
  const [searchParams] = useSearchParams();
  const days = searchParams.get('days');
  const target = searchParams.get('tab') === 'facturas' ? '/facturas' : '/boletas';
  const legacyDays = days === '7' || days === '15' || days === '30' ? Number(days) : null;
  const range = legacyDays ? documentDateRangeForLastDays(legacyDays) : null;
  const query = range ? `?from=${range.from}&to=${range.to}` : '';
  return <Navigate to={`${target}${query}`} replace />;
}

function LegacyNewDocumentRedirect() {
  const [searchParams] = useSearchParams();
  const target = searchParams.get('tipo') === 'factura' ? '/facturas/new' : '/boletas/new';
  return <Navigate to={target} replace />;
}

function AppLayout() {
  const { pathname } = useLocation();
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const setActiveCompanyId = useAppStore((s) => s.setActiveCompanyId);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const { user, loading, can } = usePermissions();
  const isMobile = useIsMobile();

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

  const currentRoute = routeMeta[normalizedPath] || routeMeta['/'];
  const permissionState = { user, loading, can, isMobile };
  const scannerMode = normalizedPath === '/scanner';

  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar hideOnMobile />

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopNavigation title={currentRoute.title} />
        <header className="hidden h-16 shrink-0 items-center border-b border-border/80 bg-background/90 px-6 backdrop-blur md:flex">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-6">
            <div className="flex min-w-0 items-center gap-3">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggleSidebar}
                className="-ml-2 hidden shrink-0 md:inline-flex"
                aria-label={sidebarCollapsed ? 'Expandir menú lateral' : 'Colapsar menú lateral'}
                title={sidebarCollapsed ? 'Expandir menú lateral' : 'Colapsar menú lateral'}
                aria-pressed={sidebarCollapsed}
              >
                <PanelLeft />
              </Button>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-semibold text-foreground">{currentRoute.title}</h1>
                <p className="truncate text-sm text-muted-foreground">{currentRoute.subtitle}</p>
              </div>
            </div>
          </div>
        </header>

        <main className={`flex-1 overflow-auto ${scannerMode ? 'p-0 md:p-6 lg:p-8' : 'p-4 md:p-6 lg:p-8'}`}>
          <div className={`mx-auto w-full ${scannerMode ? 'max-w-none md:max-w-7xl' : 'max-w-7xl'}`}>
            <Routes>
              <Route path="/" element={<HomeRedirect user={user} loading={loading} isMobile={isMobile} />} />
              <Route path="/menu" element={<MobileMenu isMobile={isMobile} />} />
              <Route path="/dashboard" element={<RequirePermission permission="dashboard" {...permissionState}><Suspense fallback={<div className="h-80 animate-pulse rounded-2xl bg-muted" />}><Dashboard /></Suspense></RequirePermission>} />
              <Route path="/pedidos" element={<RequirePermission permission="orders_inbox" {...permissionState}><Pedidos /></RequirePermission>} />
              <Route
                path="/orders"
                element={
                  import.meta.env.PROD
                    ? <Navigate to={isMobile ? '/menu' : firstAllowedPath(user)} replace />
                    : <RequirePermission permission="order_management" {...permissionState}><PedidosMulticanal /></RequirePermission>
                }
              />
              <Route path="/scanner" element={<RequirePermission permission="orders_scanner" {...permissionState}><Suspense fallback={<div className="h-80 animate-pulse rounded-2xl bg-muted" />}><ScannerArmado /></Suspense></RequirePermission>} />
              <Route path="/scanner-armado" element={<Navigate to="/scanner" replace />} />
              <Route path="/companies" element={<RequirePermission permission="companies" {...permissionState}><Companies /></RequirePermission>} />
              <Route path="/workflow" element={<Navigate to="/falabella-api" replace />} />
              <Route path="/credit-notes" element={<RequirePermission permission="credit_notes_manage" {...permissionState}><CreditNotesList /></RequirePermission>} />
              <Route path="/credit-notes/bulk" element={<RequirePermission permission="credit_notes_bulk" {...permissionState}><CreditNotes /></RequirePermission>} />
              <Route path="/falabella-api" element={<RequirePermission permission="falabella_sellers" {...permissionState}><FalabellaApi /></RequirePermission>} />
              <Route path="/productos" element={<RequirePermission permission="productos" {...permissionState}><Productos /></RequirePermission>} />
              <Route path="/auto-emision" element={<RequirePermission permission="auto_emision" {...permissionState}><AutoEmision /></RequirePermission>} />
              <Route path="/boletas" element={<RequirePermission permission="boletas" {...permissionState}><Documentos kind="boletas" /></RequirePermission>} />
              <Route path="/boletas/new" element={<RequirePermission permission="boletas" {...permissionState}><IndividualInvoice fixedDocType="03" /></RequirePermission>} />
              <Route path="/facturas" element={<RequirePermission permission="facturas" {...permissionState}><Documentos kind="facturas" /></RequirePermission>} />
              <Route path="/facturas/new" element={<RequirePermission permission="facturas" {...permissionState}><IndividualInvoice fixedDocType="01" /></RequirePermission>} />
              <Route path="/documentos" element={<LegacyDocumentsRedirect />} />
              <Route path="/documentos/nuevo" element={<LegacyNewDocumentRedirect />} />
              <Route path="/individual-invoice" element={<Navigate to="/boletas/new" replace />} />
              <Route path="/users" element={<RequirePermission permission="users" {...permissionState}><UsersPage /></RequirePermission>} />
              <Route path="/settings" element={<RequirePermission permission="settings" {...permissionState}><Settings /></RequirePermission>} />
              <Route path="*" element={<Navigate to={isMobile ? '/menu' : firstAllowedPath(user)} replace />} />
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
