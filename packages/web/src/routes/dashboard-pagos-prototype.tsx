import type { ReactNode } from 'react';
import { money, percentLabel } from '../lib/pagos-presentation';
import { cn } from '@/lib/utils';

// Question: how should the dashboard show sold vs arrives vs paid vs pending?
// Four variants plus the current KPI row, switchable via ?variant= on /dashboard.

export const DASHBOARD_PAGOS_VARIANTS = [
  { key: 'actual', name: 'Actual' },
  { key: 'A', name: 'Cuatro cifras' },
  { key: 'B', name: 'De vendido a cobrado' },
  { key: 'C', name: 'Venta y caja' },
  { key: 'D', name: 'Una línea' },
];

export type DashboardCash = {
  sold: number;
  arrives: number;
  kept: number;
  paid: number;
  pending: number;
  paidCount: number;
  pendingCount: number;
};

function share(part: number, whole: number) {
  if (!whole) return 0;
  return Math.max(0, Math.min(100, (part / whole) * 100));
}

function StateDump({ cash }: { cash: DashboardCash }) {
  return (
    <p className="font-mono text-[10px] text-muted-foreground">
      prototipo vendimos={cash.sold} te_llega={cash.arrives} se_queda={cash.kept} pagado={cash.paid} falta={cash.pending}
    </p>
  );
}

function Figure({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  tone?: 'arrive' | 'keep' | 'wait';
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn(
        'mt-1 text-[1.35rem] font-semibold tabular-nums tracking-tight',
        tone === 'arrive' && 'text-emerald-700 dark:text-emerald-400',
        tone === 'keep' && 'text-red-600 dark:text-red-400',
        tone === 'wait' && 'text-amber-700 dark:text-amber-400',
      )}
      >
        {money.format(value)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export function VariantA({ cash }: { cash: DashboardCash }) {
  return (
    <div className="space-y-2">
      <div className="grid gap-x-8 gap-y-4 border-y border-border py-4 sm:grid-cols-2 xl:grid-cols-4">
        <Figure label="Vendimos" value={cash.sold} hint="Lo que pagó el cliente." />
        <Figure label="Te llega" value={cash.arrives} hint="Después de comisión y envío." tone="arrive" />
        <Figure label="Pagado" value={cash.paid} hint={`${cash.paidCount} ventas ya depositadas.`} tone="arrive" />
        <Figure label="Falta" value={cash.pending} hint={`${cash.pendingCount} ventas aún no pagan.`} tone="wait" />
      </div>
      <StateDump cash={cash} />
    </div>
  );
}

export function VariantB({ cash }: { cash: DashboardCash }) {
  const arriveShare = share(cash.arrives, cash.sold);
  const paidShare = share(cash.paid, cash.arrives);
  return (
    <div className="space-y-3 border-y border-border py-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Vendimos</p>
          <p className="text-2xl font-semibold tabular-nums tracking-tight">{money.format(cash.sold)}</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Falabella se queda <span className="font-medium text-red-600 dark:text-red-400">{money.format(cash.kept)}</span>
        </p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-emerald-600" style={{ width: `${arriveShare}%` }} />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Te llega</p>
          <p className="text-xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{money.format(cash.arrives)}</p>
        </div>
        <p className="text-xs text-muted-foreground">{percentLabel(cash.sold ? cash.arrives / cash.sold : null)} del precio</p>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-amber-500/20">
        <div className="h-full bg-emerald-600" style={{ width: `${paidShare}%` }} />
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <p>Pagado <span className="font-medium tabular-nums">{money.format(cash.paid)}</span></p>
        <p className="text-amber-700 dark:text-amber-400">Falta <span className="font-medium tabular-nums">{money.format(cash.pending)}</span></p>
      </div>
      <StateDump cash={cash} />
    </div>
  );
}

export function VariantC({ cash }: { cash: DashboardCash }) {
  const paidShare = share(cash.paid, cash.arrives);
  return (
    <div className="space-y-2">
      <div className="grid gap-8 border-y border-border py-4 lg:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-muted-foreground">La venta</p>
          <div className="mt-3 flex items-baseline justify-between gap-4">
            <span className="text-sm">Vendimos</span>
            <span className="text-xl font-semibold tabular-nums">{money.format(cash.sold)}</span>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-4">
            <span className="text-sm">Te llega</span>
            <span className="text-xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{money.format(cash.arrives)}</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Falabella se queda {money.format(cash.kept)}.
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">La caja</p>
          <p className="mt-3 text-sm text-muted-foreground">De lo que te llega, ¿ya pagaron?</p>
          <div className="mt-2 flex h-8 overflow-hidden rounded-md bg-amber-500/15">
            <div className="grid place-items-center bg-emerald-600 text-[11px] font-medium text-white" style={{ width: `${paidShare}%` }}>
              {paidShare >= 28 ? 'Pagado' : ''}
            </div>
            <div className="grid flex-1 place-items-center text-[11px] font-medium text-amber-800 dark:text-amber-300">
              {100 - paidShare >= 28 ? 'Falta' : ''}
            </div>
          </div>
          <div className="mt-2 flex justify-between text-sm">
            <span className="tabular-nums">{money.format(cash.paid)}</span>
            <span className="tabular-nums text-amber-700 dark:text-amber-400">{money.format(cash.pending)}</span>
          </div>
        </div>
      </div>
      <StateDump cash={cash} />
    </div>
  );
}

export function VariantD({ cash }: { cash: DashboardCash }) {
  return (
    <div className="space-y-2 border-y border-border py-4">
      <p className="text-[15px] leading-6">
        Vendimos <strong className="tabular-nums">{money.format(cash.sold)}</strong>
        {' · '}
        te llega <strong className={cn('tabular-nums', 'text-emerald-700 dark:text-emerald-400')}>{money.format(cash.arrives)}</strong>
        {' · '}
        pagaron <strong className="tabular-nums">{money.format(cash.paid)}</strong>
        {' · '}
        faltan <strong className="tabular-nums text-amber-700 dark:text-amber-400">{money.format(cash.pending)}</strong>
      </p>
      <p className="text-xs text-muted-foreground">
        {cash.paidCount} pagadas · {cash.pendingCount} pendientes · Falabella se queda {money.format(cash.kept)}
      </p>
      <StateDump cash={cash} />
    </div>
  );
}

export function DashboardPagosPrototype({
  variant,
  cash,
  actual,
}: {
  variant: string;
  cash: DashboardCash;
  actual: ReactNode;
}) {
  if (variant === 'A') return <VariantA cash={cash} />;
  if (variant === 'B') return <VariantB cash={cash} />;
  if (variant === 'C') return <VariantC cash={cash} />;
  if (variant === 'D') return <VariantD cash={cash} />;
  return <>{actual}</>;
}
