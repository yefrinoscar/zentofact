import { useEffect, useState } from 'react';
import { Building2, ChevronDown, Plus } from 'lucide-react';
import { useAppStore } from '../stores/app';
import api from '../lib/api';

export default function CompanySwitcher() {
  const activeId = useAppStore((s) => s.activeCompanyId);
  const setActiveId = useAppStore((s) => s.setActiveCompanyId);
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    api.listCompanies()
      .then((list: any[]) => {
        if (!mounted) return;
        setCompanies(Array.isArray(list) ? list : []);
        setLoadError('');
      })
      .catch((error: any) => {
        if (!mounted) return;
        setCompanies([]);
        setLoadError(error?.message || 'No se pudieron cargar las empresas.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!activeId) {
      api.getActiveCompanyId().then((id: number | null) => {
        if (id) setActiveId(id);
      });
    }
  }, []);

  const active = companies.find((c) => c.id === activeId);

  const handleSelect = (id: number) => {
    setActiveId(id);
    api.setActiveCompanyId(id);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-accent"
      >
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1 truncate text-left">
          {active ? (active.nombre || active.razonSocial) : 'Seleccionar empresa'}
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-lg border border-border bg-card p-1 shadow-lg">
          {companies.map((c: any) => (
            <button
              key={c.id}
              onClick={() => handleSelect(c.id)}
              className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm ${
                c.id === activeId
                  ? 'bg-primary/20 text-primary'
                  : 'hover:bg-accent'
              }`}
            >
              <span>{c.nombre || c.razonSocial}</span>
              <span className="ml-auto text-xs text-muted-foreground">{c.ruc}</span>
            </button>
          ))}
          {loading && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              Cargando empresas...
            </p>
          )}
          {!loading && loadError && (
            <p className="px-3 py-2 text-xs text-destructive">
              {loadError}
            </p>
          )}
          {!loading && !loadError && companies.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No hay empresas. Crea una en la página de Empresas.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
