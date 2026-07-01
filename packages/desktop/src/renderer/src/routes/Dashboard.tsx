import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, FileText, CheckCircle, XCircle, ArrowRight } from 'lucide-react';
import { useAppStore } from '../stores/app';
import { Loading, Skeleton } from '../components/Loading';
import api from '../lib/api';

export default function Dashboard() {
  const activeId = useAppStore((s) => s.activeCompanyId);
  const [company, setCompany] = useState<any>(null);
  const [stats, setStats] = useState({ total: 0, aceptadas: 0, rechazadas: 0, pendientes: 0 });
  const [recent, setRecent] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeId) {
      setCompany(null);
      setRecent([]);
      setStats({ total: 0, aceptadas: 0, rechazadas: 0, pendientes: 0 });
      setLoading(false);
      return;
    }

    let mounted = true;
    setLoading(true);
    Promise.all([
      api.getCompany(activeId),
      api.listBoletas({ companyId: activeId, limit: 4 }),
    ])
      .then(([companyResult, result]: [any, any]) => {
        if (!mounted) return;
        setCompany(companyResult);
        setRecent(result.boletas);
        setStats({
          total: result.total,
          aceptadas: result.boletas.filter((boleta: any) => boleta.estadoSunat === 'ACEPTADO').length,
          rechazadas: result.boletas.filter((boleta: any) => boleta.estadoSunat === 'RECHAZADO').length,
          pendientes: result.boletas.filter((boleta: any) => boleta.estadoSunat === 'PENDIENTE').length,
        });
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [activeId]);

  if (!activeId) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <Building2 className="mx-auto mb-3 h-14 w-14 text-muted-foreground" />
        <h2 className="text-xl font-semibold text-foreground">Selecciona una empresa para ver métricas</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
          Configura o selecciona una empresa en la sección de Empresas. El workflow de emisión se activará cuando
          tengas una empresa activa.
        </p>
        <Link
          to="/companies"
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          Gestionar Empresas <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        {loading && !company ? (
          <>
            <Skeleton className="h-6 w-64" />
            <Skeleton className="mt-2 h-4 w-32" />
          </>
        ) : (
          <>
            <h2 className="text-xl font-semibold text-foreground">{company?.nombre || company?.razonSocial || 'Dashboard'}</h2>
            <p className="text-sm text-muted-foreground">RUC: {company?.ruc}</p>
          </>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={FileText} label="Total Boletas" value={stats.total} loading={loading} />
        <StatCard icon={CheckCircle} label="Aceptadas" value={stats.aceptadas} color="text-emerald-700" loading={loading} />
        <StatCard icon={XCircle} label="Rechazadas" value={stats.rechazadas} color="text-red-700" loading={loading} />
        <StatCard icon={FileText} label="Pendientes" value={stats.pendientes} color="text-amber-700" loading={loading} />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="text-base font-semibold text-foreground">Boletas Recientes</h3>
        </div>
        {loading ? (
          <Loading label="Cargando boletas recientes..." />
        ) : recent.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">No hay boletas emitidas aún.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/35">
              <tr className="text-left">
                <th className="p-3 font-medium text-muted-foreground">Número</th>
                <th className="p-3 font-medium text-muted-foreground">Fecha</th>
                <th className="p-3 font-medium text-muted-foreground">Estado</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((boleta: any) => (
                <tr key={boleta.id} className="border-t border-border/70">
                  <td className="p-3 font-mono text-xs">{boleta.numeroCompleto}</td>
                  <td className="p-3">{boleta.fechaEmision}</td>
                  <td className="p-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        boleta.estadoSunat === 'ACEPTADO'
                          ? 'bg-emerald-100 text-emerald-700'
                          : boleta.estadoSunat === 'RECHAZADO'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {boleta.estadoSunat}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Link
        to="/workflow"
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
      >
        Nueva Emisión <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color = 'text-foreground',
  loading = false,
}: {
  icon: any;
  label: string;
  value: number;
  color?: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <Icon className={`h-5 w-5 ${color}`} />
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-12" />
      ) : (
        <p className={`mt-1 text-2xl font-semibold ${color}`}>{value}</p>
      )}
    </div>
  );
}
