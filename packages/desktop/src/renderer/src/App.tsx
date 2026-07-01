import { useEffect, useState } from 'react';
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Pause, Play } from 'lucide-react';
import Sidebar from './components/Sidebar';
import Dashboard from './routes/Dashboard';
import Companies from './routes/Companies';
import Workflow from './routes/Workflow';
import CreditNotes from './routes/CreditNotes';
import DailySummaries from './routes/DailySummaries';
import Settings from './routes/Settings';
import FalabellaApi from './routes/FalabellaApi';
import { useAppStore } from './stores/app';
import api from './lib/api';

const routeMeta: Record<string, { title: string; subtitle: string }> = {
  '/': {
    title: 'Panel General',
    subtitle: 'Resumen operativo y acceso rápido a emisión y control.',
  },
  '/companies': {
    title: 'Empresas',
    subtitle: 'Configura empresas, credenciales y certificados de emisión.',
  },
  '/workflow': {
    title: 'Nueva Emisión',
    subtitle: 'Flujo guiado para procesar boletas electrónicas en lote.',
  },
  '/credit-notes': {
    title: 'Notas de Crédito',
    subtitle: 'Anula boletas por mes y empresa emitiendo notas de crédito, individuales o en grupo.',
  },
  '/falabella-api': {
    title: 'Falabella API',
    subtitle: 'Consulta órdenes por empresa usando las credenciales Seller API guardadas.',
  },
  '/summaries': {
    title: 'Resúmenes Diarios',
    subtitle: 'Consulta tickets, CDR y estado de los envíos por resumen diario.',
  },
  '/settings': {
    title: 'Ajustes',
    subtitle: 'Preferencias generales de salida y configuración local.',
  },
};

function AppLayout() {
  const { pathname } = useLocation();
  const activeCompanyId = useAppStore((s) => s.activeCompanyId);
  const setActiveCompanyId = useAppStore((s) => s.setActiveCompanyId);
  const [activeCompanyLabel, setActiveCompanyLabel] = useState('Sin empresa activa');
  const [headerCompanies, setHeaderCompanies] = useState<any[]>([]);
  const [workflowCanStart, setWorkflowCanStart] = useState(false);
  const [workflowRunning, setWorkflowRunning] = useState(false);
  const [workflowDateFrom, setWorkflowDateFrom] = useState(() => {
    const from = new Date();
    from.setDate(from.getDate() - 7);
    return `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
  });
  const [workflowDateTo, setWorkflowDateTo] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });

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

  useEffect(() => {
    let mounted = true;

    if (!activeCompanyId) {
      setActiveCompanyLabel('Sin empresa activa');
      setWorkflowCanStart(false);
      return () => {
        mounted = false;
      };
    }

    api.getCompany(activeCompanyId).then((company: any) => {
      if (!mounted || !company) return;
      setActiveCompanyLabel(`${company.nombre || company.razonSocial} (${company.ruc})`);
      setWorkflowCanStart(!!(company.sellerUsername && company.sellerPassword));
    }).catch(() => {
      if (!mounted) return;
      setActiveCompanyLabel('Empresa activa');
      setWorkflowCanStart(false);
    });

    return () => {
      mounted = false;
    };
  }, [activeCompanyId]);

  useEffect(() => {
    let mounted = true;

    if (pathname !== '/workflow') {
      setHeaderCompanies([]);
      return () => {
        mounted = false;
      };
    }

    api.listCompanies().then((companies: any[]) => {
      if (!mounted) return;
      setHeaderCompanies(companies);
    }).catch(() => {
      if (!mounted) return;
      setHeaderCompanies([]);
    });

    return () => {
      mounted = false;
    };
  }, [pathname, activeCompanyId]);

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ running: boolean }>;
      setWorkflowRunning(!!custom.detail?.running);
    };

    window.addEventListener('workflow:running-state', handler as EventListener);
    return () => {
      window.removeEventListener('workflow:running-state', handler as EventListener);
    };
  }, []);

  useEffect(() => {
    if (pathname !== '/workflow') return;
    window.dispatchEvent(
      new CustomEvent('workflow:set-date-range', {
        detail: { dateFrom: workflowDateFrom, dateTo: workflowDateTo || '' },
      }),
    );
  }, [pathname, workflowDateFrom, workflowDateTo]);

  const currentRoute = routeMeta[pathname] || routeMeta['/'];

  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-border/80 bg-background/90 px-6 py-4 backdrop-blur">
          <div className="mx-auto flex w-full max-w-7xl items-start justify-between gap-6">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">ZENTOFACTO</p>
              <h1 className="text-xl font-semibold text-foreground">{currentRoute.title}</h1>
              <p className="text-sm text-muted-foreground">{currentRoute.subtitle}</p>
            </div>

            {pathname === '/workflow' && headerCompanies.length > 0 ? (
              <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-muted-foreground">Desde</label>
                  <input
                    type="date"
                    value={workflowDateFrom}
                    onChange={(event) => setWorkflowDateFrom(event.target.value)}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring"
                    required
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-muted-foreground">Hasta</label>
                  <input
                    type="date"
                    value={workflowDateTo}
                    onChange={(event) => setWorkflowDateTo(event.target.value)}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring"
                  />
                  <button
                    type="button"
                    onClick={() => setWorkflowDateTo('')}
                    className="h-10 rounded-md border border-border px-3 text-xs font-medium text-muted-foreground hover:bg-accent"
                  >
                    Limpiar
                  </button>
                </div>
                <select
                  value={activeCompanyId ? String(activeCompanyId) : ''}
                  onChange={async (event) => {
                    const nextId = event.target.value ? Number(event.target.value) : null;
                    setActiveCompanyId(nextId);
                    await api.setActiveCompanyId(nextId);
                  }}
                  className="h-10 min-w-[420px] max-w-[520px] rounded-md border border-input bg-background px-4 text-sm text-foreground outline-none focus:border-ring"
                >
                  {headerCompanies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.nombre || company.razonSocial} ({company.ruc})
                    </option>
                  ))}
                </select>
                <button
                  onClick={() =>
                    window.dispatchEvent(new CustomEvent(workflowRunning ? 'workflow:pause-scraping' : 'workflow:start-scraping'))
                  }
                  disabled={!workflowCanStart || !workflowDateFrom}
                  aria-label={workflowRunning ? 'Pausar extracción' : 'Iniciar extracción'}
                  title={workflowRunning ? 'Pausar extracción' : 'Iniciar extracción'}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50"
                >
                  {workflowRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
              </div>
            ) : (
              <div className="max-w-[460px] truncate pt-2 text-xs text-muted-foreground">
                {activeCompanyLabel}
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6 lg:p-8">
          <div className="mx-auto w-full max-w-7xl">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/companies" element={<Companies />} />
              <Route path="/workflow" element={<Workflow />} />
              <Route path="/credit-notes" element={<CreditNotes />} />
              <Route path="/falabella-api" element={<FalabellaApi />} />
              <Route path="/summaries" element={<DailySummaries />} />
              <Route path="/settings" element={<Settings />} />
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
      <AppLayout />
    </HashRouter>
  );
}
