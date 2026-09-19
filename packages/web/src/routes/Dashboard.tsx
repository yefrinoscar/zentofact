import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import {
  Activity,
  ArrowRight,
  CalendarDays,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import api from '../lib/api';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

type PeriodKey = '7d' | '30d' | 'month' | '90d' | 'custom';

type DashboardFilters = {
  from: string;
  to: string;
  companyId?: number;
};

const money = new Intl.NumberFormat('es-PE', {
  style: 'currency',
  currency: 'PEN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const integer = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 });
const compactMoney = new Intl.NumberFormat('es-PE', {
  notation: 'compact',
  style: 'currency',
  currency: 'PEN',
  maximumFractionDigits: 1,
});
const dateLabel = new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', timeZone: 'UTC' });

const RECEIVE = '#059669';
const WAIT = '#d97706';
const LOSS = '#e11d48';

function localToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

function dateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function rangeLabel(from: string, to: string) {
  const start = dateFromKey(from);
  const end = dateFromKey(to);
  if (from === to) return format(start, "d 'de' MMMM", { locale: es });
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${format(start, 'd', { locale: es })} – ${format(end, "d 'de' MMMM 'de' yyyy", { locale: es })}`;
  }
  return `${format(start, 'd MMM', { locale: es })} – ${format(end, 'd MMM yyyy', { locale: es })}`;
}

function rangeFor(period: Exclude<PeriodKey, 'custom'>) {
  const to = localToday();
  if (period === 'month') return { from: `${to.slice(0, 7)}-01`, to };
  const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
  return { from: addDays(to, -(days - 1)), to };
}

function formatDay(value: unknown) {
  const day = String(value || '').slice(0, 10);
  return day ? dateLabel.format(new Date(`${day}T12:00:00.000Z`)) : '';
}

function Trend({ value }: { value: number | null | undefined }) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const up = Number(value) >= 0;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-semibold tabular-nums', up ? 'text-emerald-600' : 'text-red-600')}>
      <TrendingUp className={cn('size-3.5', !up && 'rotate-180')} />
      {Math.abs(Number(value)).toFixed(1)}%
    </span>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{children}</p>;
}

function Metric({
  label,
  value,
  hint,
  tone = 'neutral',
  delta,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'neutral' | 'receive' | 'wait';
  delta?: number | null;
}) {
  return (
    <div className="min-w-0">
      <Eyebrow>{label}</Eyebrow>
      <p className={cn(
        'mt-2 whitespace-nowrap text-[1.75rem] font-semibold tracking-[-0.045em] tabular-nums lg:text-[2rem]',
        tone === 'receive' && 'text-emerald-700 dark:text-emerald-500',
        tone === 'wait' && 'text-amber-700 dark:text-amber-500',
      )}>
        {value}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>{hint}</span>
        {delta !== undefined ? <Trend value={delta} /> : null}
      </div>
    </div>
  );
}

function FlowStep({
  label,
  value,
  hint,
  tone = 'neutral',
  strong,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'neutral' | 'receive' | 'loss';
  strong?: boolean;
}) {
  return (
    <div className="min-w-[120px] flex-1">
      <Eyebrow>{label}</Eyebrow>
      <p className={cn(
        'mt-1.5 text-lg font-semibold tracking-[-0.02em] tabular-nums',
        tone === 'receive' && 'text-emerald-700 dark:text-emerald-500',
        tone === 'loss' && 'text-rose-600 dark:text-rose-400',
        strong && 'text-xl',
      )}>
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function SalesTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  return (
    <div className="min-w-52 rounded-xl border border-border bg-popover/95 p-3 text-xs shadow-lg backdrop-blur">
      <p className="mb-1.5 font-medium">{formatDay(row.day)}</p>
      <p className="flex justify-between gap-6"><span className="text-muted-foreground">Facturado</span><strong className="tabular-nums text-primary">{money.format(row.netSales || 0)}</strong></p>
      <p className="flex justify-between gap-6"><span className="text-muted-foreground">Neto</span><strong className="tabular-nums" style={{ color: RECEIVE }}>{money.format(row.netSalesNet || 0)}</strong></p>
      <p className="flex justify-between gap-6"><span className="text-muted-foreground">Pedidos</span><strong className="tabular-nums">{integer.format(row.orders || 0)}</strong></p>
    </div>
  );
}

function SkeletonDashboard() {
  return (
    <div className="animate-pulse space-y-8">
      <div className="h-9 w-72 rounded-xl bg-muted" />
      <div className="h-28 rounded-xl bg-muted" />
      <div className="h-16 rounded-xl bg-muted" />
      <div className="h-[360px] rounded-xl bg-muted" />
      <div className="h-72 rounded-xl bg-muted" />
    </div>
  );
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<PeriodKey>('month');
  const initialRange = useMemo(() => rangeFor('month'), []);
  const [filters, setFilters] = useState<DashboardFilters>(initialRange);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [selectedRange, setSelectedRange] = useState<DateRange>({
    from: dateFromKey(initialRange.from),
    to: dateFromKey(initialRange.to),
  });

  const query = useQuery({
    queryKey: ['dashboard', filters],
    queryFn: () => api.getDashboard(filters),
    refetchInterval: 5 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
  const refresh = useMutation({
    mutationFn: () => api.syncOrdersInbox(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
  const data: any = query.data;

  const choosePeriod = (next: Exclude<PeriodKey, 'custom'>) => {
    const nextRange = rangeFor(next);
    setPeriod(next);
    setFilters((current) => ({ ...current, ...nextRange }));
    setSelectedRange({ from: dateFromKey(nextRange.from), to: dateFromKey(nextRange.to) });
  };
  const chooseRange = (next: DateRange | undefined) => {
    setSelectedRange(next || { from: undefined, to: undefined });
    if (!next?.from || !next?.to) return;
    setPeriod('custom');
    setFilters((current) => ({ ...current, from: dateKey(next.from!), to: dateKey(next.to!) }));
    setCalendarOpen(false);
  };

  if (query.isLoading) return <SkeletonDashboard />;
  if (query.isError) {
    return (
      <Card className="mx-auto mt-16 max-w-lg text-center">
        <CardContent className="px-8 py-10">
          <Activity className="mx-auto size-10 text-destructive" />
          <h2 className="mt-4 text-lg font-semibold">No pudimos cargar el dashboard</h2>
          <p className="mt-2 text-sm text-muted-foreground">{String((query.error as Error)?.message || 'Error inesperado')}</p>
          <Button className="mt-5" onClick={() => query.refetch()}>Reintentar</Button>
        </CardContent>
      </Card>
    );
  }

  const summary = data?.summary || {};
  const days = data?.salesByDay || [];
  const orders = Number(summary.orders || 0);
  const settledOrders = Number(summary.settledOrders || 0);
  const uncrossedSales = Number(summary.uncrossedSales || 0);
  const arrived = Number(summary.arrives || 0);
  const facturado = Number(summary.netSales || 0);
  const crossedShare = orders > 0 ? (settledOrders / orders) * 100 : 0;
  const netoShare = facturado > 0 ? (arrived / facturado) * 100 : 0;
  const comparisonLabel = `vs. ${rangeLabel(data?.filters?.previousFrom || filters.from, data?.filters?.previousTo || filters.to)}`;
  const flow = [
    { label: 'Facturado', value: money.format(facturado), hint: `${integer.format(orders)} pedidos`, tone: 'neutral' as const },
    { label: 'Cruzado', value: money.format(summary.settledBruto || 0), hint: `${integer.format(settledOrders)} pedidos · ${crossedShare.toFixed(1)}%`, tone: 'neutral' as const },
    { label: 'Comisión', value: `− ${money.format(summary.commission || 0)}`, hint: 'Falabella', tone: 'loss' as const },
    { label: 'Logística', value: `− ${money.format(summary.otherFees || 0)}`, hint: 'Falabella', tone: 'loss' as const },
    { label: 'Neto', value: money.format(arrived), hint: 'Te llega', tone: 'receive' as const, strong: true },
  ];

  return (
    <div className="space-y-8 pb-8">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-fit flex-wrap items-center gap-1 rounded-xl bg-muted/60 p-1">
          {([
            ['7d', '7 días'],
            ['30d', '30 días'],
            ['month', 'Este mes'],
            ['90d', '90 días'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => choosePeriod(key)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                period === key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex w-fit flex-wrap items-center gap-2">
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="h-9 w-[220px] justify-start rounded-xl bg-background px-3 text-left text-xs font-normal">
                <CalendarDays className="size-4 text-muted-foreground" />
                <span className="truncate">{rangeLabel(filters.from, filters.to)}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto max-w-[calc(100vw-2rem)] overflow-auto p-1.5">
              <Calendar
                mode="range"
                selected={selectedRange}
                onSelect={chooseRange}
                defaultMonth={selectedRange.from}
                numberOfMonths={2}
                locale={es}
                disabled={{ after: dateFromKey(localToday()) }}
                autoFocus
              />
            </PopoverContent>
          </Popover>

          <Select
            value={filters.companyId ? String(filters.companyId) : 'all'}
            onValueChange={(value) => setFilters((current) => ({
              ...current,
              companyId: value === 'all' ? undefined : Number(value),
            }))}
          >
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Todas las tiendas" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las tiendas</SelectItem>
              {(data?.companies || []).map((company: any) => <SelectItem key={company.id} value={String(company.id)}>{company.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="icon"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending || query.isFetching}
            title="Sincronizar ventas"
          >
            <RefreshCw className={cn('size-4', (refresh.isPending || query.isFetching) && 'animate-spin')} />
          </Button>
        </div>
      </section>

      <section className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0 lg:divide-x lg:divide-border/70">
        <div className="lg:pr-6">
          <Metric label="Facturado" value={money.format(facturado)} hint={`${integer.format(orders)} pedidos`} delta={data?.changes?.netSales} />
        </div>
        <div className="lg:px-6">
          <Metric label="Neto" value={money.format(arrived)} hint="Te llega" tone="receive" />
        </div>
        <div className="lg:px-6">
          <Metric label="Cobrado" value={money.format(summary.paidSales || 0)} hint="Ya depositaron" />
        </div>
        <div className="lg:pl-6">
          <Metric label="Por cobrar" value={money.format(summary.pendingSales || 0)} hint="Aún no pagan" tone="wait" />
        </div>
      </section>

      <section className="border-t border-border/70 pt-7">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow>Del facturado al neto</Eyebrow>
          <p className="text-xs text-muted-foreground">
            {money.format(uncrossedSales)} sin conciliar · cruce {crossedShare.toFixed(1)}% · {netoShare.toFixed(1)}% del facturado
          </p>
        </div>
        <div className="mt-5 flex flex-wrap items-stretch gap-y-5">
          {flow.map((step, index) => (
            <Fragment key={step.label}>
              {index > 0 ? (
                <ArrowRight className="mx-3 hidden size-4 shrink-0 self-center text-muted-foreground/40 sm:block" />
              ) : null}
              <FlowStep label={step.label} value={step.value} hint={step.hint} tone={step.tone} strong={step.strong} />
            </Fragment>
          ))}
        </div>
      </section>

      <section className="grid gap-10 border-t border-border/70 pt-7 lg:grid-cols-[minmax(0,2.1fr)_minmax(0,1fr)] lg:gap-0 lg:divide-x lg:divide-border/70">
        <div className="min-w-0 lg:pr-10">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <Eyebrow>Evolución</Eyebrow>
              <h2 className="mt-1 text-xl font-semibold tracking-tight">Facturado y neto por día</h2>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-primary" />Facturado</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: RECEIVE }} />Neto</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-muted-foreground/40" />Periodo anterior</span>
            </div>
          </div>
          <div className="mt-5 h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={days} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="dashFacturado" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="dashNeto" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={RECEIVE} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={RECEIVE} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 6" />
                <XAxis dataKey="day" tickFormatter={formatDay} axisLine={false} tickLine={false} tickMargin={12} minTickGap={30} fontSize={11} stroke="var(--muted-foreground)" />
                <YAxis orientation="right" tickFormatter={(value) => compactMoney.format(value)} axisLine={false} tickLine={false} tickMargin={10} width={64} fontSize={11} stroke="var(--muted-foreground)" />
                <Tooltip content={<SalesTooltip />} cursor={{ stroke: 'var(--muted-foreground)', strokeDasharray: '3 4', strokeOpacity: 0.35 }} />
                <Area type="monotone" dataKey="previousSales" stroke="var(--muted-foreground)" strokeOpacity={0.45} strokeWidth={1.5} strokeDasharray="4 4" fill="none" dot={false} activeDot={false} />
                <Area type="monotone" dataKey="netSales" stroke="var(--primary)" strokeWidth={2.5} fill="url(#dashFacturado)" activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--background)' }} />
                <Area type="monotone" dataKey="netSalesNet" stroke={RECEIVE} strokeWidth={2.25} fill="url(#dashNeto)" activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--background)' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="min-w-0 lg:pl-10">
          <Eyebrow>Composición</Eyebrow>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">De cada sol cruzado</h2>
          <CompositionDonut summary={summary} />
        </div>
      </section>

      <div className="flex items-center gap-2 border-t border-border/70 px-1 pt-5 text-xs text-muted-foreground">
        <Activity className="size-4" />
        El neto sale de los pedidos cruzados con el estado de cuenta. {comparisonLabel}.
      </div>
    </div>
  );
}

function CompositionDonut({ summary }: { summary: any }) {
  const com = Number(summary.commission || 0);
  const log = Number(summary.otherFees || 0);
  const neto = Number(summary.arrives || 0);
  const total = Math.max(1, com + log + neto);
  const comDeg = (com / total) * 360;
  const logDeg = ((com + log) / total) * 360;
  return (
    <div className="mt-5 flex flex-wrap items-center gap-7">
      <div
        className="relative size-40 shrink-0 rounded-full"
        style={{ background: `conic-gradient(from -90deg, ${LOSS} 0 ${comDeg}deg, ${WAIT} ${comDeg}deg ${logDeg}deg, ${RECEIVE} ${logDeg}deg 360deg)` }}
      >
        <div className="absolute inset-[27%] grid place-items-center rounded-full bg-background text-center">
          <span>
            <span className="block text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Neto</span>
            <span className="mt-0.5 block text-sm font-semibold tabular-nums">{money.format(neto)}</span>
          </span>
        </div>
      </div>
      <div className="min-w-[9rem] flex-1 space-y-3 text-sm">
        <p className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-2 text-muted-foreground"><span className="size-2 rounded-full" style={{ background: LOSS }} />Comisión</span>
          <strong className="tabular-nums">{money.format(com)}</strong>
        </p>
        <p className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-2 text-muted-foreground"><span className="size-2 rounded-full" style={{ background: WAIT }} />Logística</span>
          <strong className="tabular-nums">{money.format(log)}</strong>
        </p>
        <p className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-2 text-muted-foreground"><span className="size-2 rounded-full" style={{ background: RECEIVE }} />Neto</span>
          <strong className="tabular-nums text-emerald-700 dark:text-emerald-500">{money.format(neto)}</strong>
        </p>
        <p className="border-t border-border/70 pt-3 text-xs text-muted-foreground">
          Cancelaciones {money.format(summary.cancelledSales || 0)} · Se queda {money.format(summary.take || 0)}
        </p>
      </div>
    </div>
  );
}
