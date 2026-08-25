import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Plus, ShoppingBag } from 'lucide-react';
import api from '../lib/api';
import {
  formatSaleMoney,
  saleListRow,
  salespersonKpis,
  type SalespersonHome,
} from '../lib/mis-ventas-presentation';
import {
  flashFromMisVentasState,
  humanizeSaleError,
  type MisVentasLocationState,
  type SaleFlash,
} from '../lib/sale-feedback';
import { SaleFlashNotice } from '../components/SaleFlashNotice';
import { Button } from '../components/ui/button';

export default function MisVentas() {
  const navigate = useNavigate();
  const location = useLocation();
  const [flash, setFlash] = useState<SaleFlash | null>(null);
  const homeQuery = useQuery({
    queryKey: ['salesperson-home'],
    queryFn: () => api.getSalespersonHome() as Promise<SalespersonHome>,
    staleTime: 15_000,
  });
  const kpis = salespersonKpis(homeQuery.data);
  const orders = homeQuery.data?.orders || [];
  const loadError = homeQuery.error
    ? humanizeSaleError((homeQuery.error as Error).message || 'No se pudieron cargar tus ventas.')
    : '';

  useEffect(() => {
    const state = location.state as MisVentasLocationState | null;
    const next = flashFromMisVentasState(state);
    if (!next && !state?.registered && !state?.flash) return;
    if (next) setFlash(next);
    // Optimistic cache already updated in Nueva venta; do not refetch here or the
    // sale can vanish before the create request finishes.
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  return (
    <div className="space-y-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-stretch sm:justify-end">
        <Button type="button" className="h-11 w-full sm:h-9 sm:w-auto" onClick={() => navigate('/orders/nueva')}>
          <Plus data-icon="inline-start" />
          Registrar venta
        </Button>
      </div>

      {flash && <SaleFlashNotice flash={flash} onDismiss={() => setFlash(null)} />}

      {loadError && (
        <SaleFlashNotice
          flash={{
            tone: 'error',
            title: 'No se pudo cargar',
            detail: loadError,
            hint: 'Desliza hacia abajo o vuelve a entrar.',
          }}
        />
      )}

      <section aria-label="Indicadores personales" className="grid grid-cols-2 gap-3">
        {kpis.map((kpi) => (
          <div key={kpi.period} className="min-w-0 border-b border-border pb-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{kpi.period}</p>
            {homeQuery.isPending && !homeQuery.data
              ? <div className="mt-2 h-7 w-24 max-w-full animate-pulse rounded bg-muted" />
              : <p className="mt-1 truncate text-lg font-semibold tabular-nums tracking-tight sm:text-xl">{formatSaleMoney(kpi.total)}</p>}
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              {kpi.orders} {kpi.orders === 1 ? 'pedido' : 'pedidos'}
              {' · '}
              <span className="whitespace-nowrap">{formatSaleMoney(kpi.commission)} comisión</span>
            </p>
          </div>
        ))}
      </section>

      {homeQuery.isPending && !homeQuery.data ? (
        <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Cargando ventas…
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-14 text-center">
          <ShoppingBag className="size-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">Aún no hay ventas tuyas</p>
          <p className="text-sm text-muted-foreground">Registra la primera para verla aquí.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {orders.map((order, index) => {
            const row = saleListRow(order);
            return (
              <li key={`${row.number}-${index}`} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.number}</p>
                  <p className="truncate text-sm text-muted-foreground">{row.customer}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{row.payment} · {row.date}</p>
                </div>
                <p className="shrink-0 text-sm font-semibold tabular-nums">{formatSaleMoney(row.total)}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
