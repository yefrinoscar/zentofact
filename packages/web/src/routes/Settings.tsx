import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, ChevronRight, Plus } from 'lucide-react';
import api from '../lib/api';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { type AppTheme, getStoredTheme, setStoredTheme } from '../lib/theme';
import { cn } from '../lib/cn';
import { usePermissions } from '../hooks/usePermissions';

export default function Settings() {
  const { can, loading: permLoading } = usePermissions();
  const canCompanies = can('companies');
  const [companies, setCompanies] = useState<any[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [theme, setTheme] = useState<AppTheme>(() => getStoredTheme());

  useEffect(() => {
    if (permLoading) return;
    if (!canCompanies) {
      setCompanies([]);
      return;
    }
    let mounted = true;
    setLoadingCompanies(true);
    api.listCompanies()
      .then((list: any[]) => {
        if (mounted) setCompanies(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (mounted) setCompanies([]);
      })
      .finally(() => {
        if (mounted) setLoadingCompanies(false);
      });

    return () => {
      mounted = false;
    };
  }, [canCompanies, permLoading]);

  const changeTheme = (value: string) => {
    const nextTheme = value === 'dark' ? 'dark' : 'light';
    setTheme(nextTheme);
    setStoredTheme(nextTheme);
  };

  const displayedCompanies = companies.slice(0, 5);
  const hiddenCompanyCount = Math.max(companies.length - displayedCompanies.length, 0);

  return (
    <div className="max-w-5xl space-y-0 text-foreground">
      <section className="border-b border-border pb-8">
        <div className="grid gap-6 sm:grid-cols-[220px_1fr] sm:items-start">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Apariencia</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Preferencias visuales guardadas en este navegador.
            </p>
          </div>

          <div className="border-y border-border py-4">
            <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Tema
            </label>
            <Tabs value={theme} onValueChange={changeTheme}>
              <TabsList>
                <TabsTrigger value="light">Light theme</TabsTrigger>
                <TabsTrigger value="dark">Dark theme</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      </section>

      {canCompanies && (
        <section className="py-8">
          <div className="grid gap-6 sm:grid-cols-[220px_1fr] sm:items-start">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Empresas</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Empresas disponibles para emisión y automatización.
              </p>
            </div>

            <div>
              {loadingCompanies ? (
                <div className="border-y border-border py-4 text-sm text-muted-foreground">Cargando empresas...</div>
              ) : companies.length === 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-4 border-y border-border py-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">No hay empresas registradas.</p>
                    <p className="mt-1 text-sm text-muted-foreground">Agrega una empresa para configurar SUNAT y Falabella.</p>
                  </div>
                  <Link
                    to="/companies"
                    className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                  >
                    <Plus className="h-4 w-4" />
                    Agregar
                  </Link>
                </div>
              ) : (
                <div className="border-y border-border">
                  <div className="divide-y divide-border">
                    {displayedCompanies.map((company) => (
                      <CompanyRow key={company.id} company={company} />
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3">
                    <p className="text-xs text-muted-foreground">
                      {hiddenCompanyCount > 0
                        ? `${displayedCompanies.length} de ${companies.length} empresas visibles`
                        : `${companies.length} empresa${companies.length === 1 ? '' : 's'} registrada${companies.length === 1 ? '' : 's'}`}
                    </p>
                    <Link
                      to="/companies"
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary transition hover:opacity-80"
                    >
                      Administrar empresas
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function CompanyRow({ company }: { company: any }) {
  const name = company.nombre || company.razonSocial || 'Empresa sin nombre';
  const complete = !!(
    company.certificado
    && company.usuarioSol
    && company.claveSol
    && company.falabellaApiUserId
    && company.falabellaApiKey
  );

  return (
    <div className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Building2 className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">RUC {company.ruc || '-'}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 pl-11 sm:pl-0">
        <span className={cn('h-2 w-2 rounded-full', complete ? 'bg-emerald-500' : 'bg-amber-500')} />
        <span className="text-xs font-medium text-muted-foreground">
          {complete ? 'Configurada' : 'Pendiente'}
        </span>
      </div>
    </div>
  );
}
