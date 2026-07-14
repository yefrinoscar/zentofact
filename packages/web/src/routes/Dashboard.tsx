import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  CalendarDays,
  FileCheck2,
  FileText,
  RefreshCw,
  TrendingUp,
  WalletCards,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import api from '../lib/api';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Tooltip as StatusTooltip,
  TooltipContent as StatusTooltipContent,
  TooltipTrigger as StatusTooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
const dateLabel = new Intl.DateTimeFormat('es-PE', {
  day: '2-digit',
  month: 'short',
  timeZone: 'UTC',
});
const dateTimeLabel = new Intl.DateTimeFormat('es-PE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Lima',
});

type DocumentStatus = 'ACEPTADO' | 'REGISTRADO' | 'PENDIENTE' | 'RECHAZADO' | 'ANULADO';

const DOCUMENT_STATUS: Record<DocumentStatus, { label: string; description: string; dot: string }> = {
  ACEPTADO: {
    label: 'Aceptados',
    description: 'Comprobantes aceptados por SUNAT.',
    dot: 'bg-emerald-500',
  },
  REGISTRADO: {
    label: 'Registrados',
    description: 'Comprobantes guardados desde una fuente externa, sin aceptación SUNAT confirmada.',
    dot: 'bg-slate-500',
  },
  PENDIENTE: {
    label: 'Pendientes',
    description: 'Comprobantes en espera de envío o respuesta de SUNAT.',
    dot: 'bg-amber-500',
  },
  RECHAZADO: {
    label: 'Rechazados',
    description: 'Comprobantes observados o rechazados por SUNAT.',
    dot: 'bg-red-500',
  },
  ANULADO: {
    label: 'Anulados',
    description: 'Comprobantes anulados o reemplazados.',
    dot: 'bg-slate-400',
  },
};

function statusMeta(value: unknown) {
  const key = String(value || '').trim().toUpperCase() as DocumentStatus;
  return DOCUMENT_STATUS[key] || {
    label: key ? key.charAt(0) + key.slice(1).toLocaleLowerCase('es-PE') : 'Sin estado',
    description: key ? `Estado de origen no catalogado: ${key}.` : 'El comprobante no tiene un estado informado.',
    dot: 'bg-slate-400',
  };
}

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
  if (from === to) return format(start, "d 'de' MMMM 'de' yyyy", { locale: es });
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${format(start, 'd', { locale: es })} – ${format(end, "d 'de' MMMM 'de' yyyy", { locale: es })}`;
  }
  return `${format(start, 'd MMM yyyy', { locale: es })} – ${format(end, 'd MMM yyyy', { locale: es })}`;
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

function formatChange(value: number | null | undefined) {
  if (value === null) return 'Nuevo';
  return `${Math.abs(Number(value || 0)).toFixed(1)}%`;
}

function KpiCard({
  title,
  value,
  detail,
  change,
  icon: Icon,
  accent = false,
}: {
  title: string;
  value: string;
  detail: string;
  change?: number | null;
  icon: typeof TrendingUp;
  accent?: boolean;
}) {
  const positive = change == null || change >= 0;
  return (
    <Card className={cn('gap-4 py-5', accent && 'bg-primary text-primary-foreground ring-primary/20')}>
      <CardContent className="px-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className={cn('text-xs font-medium', accent ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
              {title}
            </p>
            <p className="mt-2 whitespace-nowrap text-[1.35rem] font-semibold tracking-[-0.035em] tabular-nums 2xl:text-2xl">{value}</p>
          </div>
          <span className={cn(
            'grid size-9 shrink-0 place-items-center rounded-xl',
            accent ? 'bg-white/12 text-white' : 'bg-primary/8 text-primary dark:bg-primary/15',
          )}>
            <Icon className="size-[18px]" />
          </span>
        </div>
        <div className="mt-4 flex items-center justify-between gap-2 text-xs">
          <span className={accent ? 'text-primary-foreground/65' : 'text-muted-foreground'}>{detail}</span>
          {change !== undefined && (
            <span className={cn(
              'inline-flex items-center gap-0.5 font-semibold',
              accent ? 'text-white' : positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
            )}>
              {positive ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
              {formatChange(change)}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SalesTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  return (
    <div className="min-w-48 rounded-xl border border-border/80 bg-popover/95 p-3 text-xs shadow-xl backdrop-blur">
      <p className="mb-2 font-medium text-foreground">{formatDay(label)}</p>
      <div className="space-y-1.5 text-muted-foreground">
        <p className="flex justify-between gap-6"><span>Ventas aceptadas</span><strong className="text-foreground">{money.format(row.grossSales || 0)}</strong></p>
        <p className="flex justify-between gap-6"><span>Notas de crédito</span><strong className="text-orange-600">−{money.format(row.creditNotes || 0)}</strong></p>
        <p className="flex justify-between gap-6 border-t border-border pt-1.5"><span>Después de notas de crédito</span><strong className="text-primary">{money.format(row.netSales || 0)}</strong></p>
      </div>
    </div>
  );
}

function DocumentsTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  return (
    <div className="min-w-40 rounded-xl border border-border/80 bg-popover/95 p-3 text-xs shadow-xl backdrop-blur">
      <p className="mb-2 font-medium text-foreground">{formatDay(label)}</p>
      <p className="flex justify-between gap-6 text-muted-foreground"><span>Boletas</span><strong className="text-sky-600">{integer.format(row.boletas || 0)}</strong></p>
      <p className="mt-1 flex justify-between gap-6 text-muted-foreground"><span>Facturas</span><strong className="text-violet-600">{integer.format(row.facturas || 0)}</strong></p>
    </div>
  );
}

function DocumentMixTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const item = payload[0] || {};
  const label = String(item.name || item.payload?.type || 'Comprobantes');
  const isInvoice = label.toLocaleLowerCase('es-PE').includes('factura');
  return (
    <div className="min-w-40 rounded-xl border border-border/80 bg-popover/95 p-3 text-xs shadow-xl backdrop-blur">
      <p className="font-medium text-foreground">{label}</p>
      <div className="mt-2 flex items-center justify-between gap-8">
        <span className="text-muted-foreground">Cantidad</span>
        <strong className={isInvoice ? 'text-violet-600' : 'text-sky-600'}>{integer.format(Number(item.value || 0))}</strong>
      </div>
    </div>
  );
}

function CompanyRankingTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const company = payload[0]?.payload || {};
  return (
    <div className="min-w-60 rounded-xl border border-border/80 bg-popover/95 p-3 text-xs shadow-xl backdrop-blur">
      <p className="mb-2 max-w-64 font-medium text-foreground">{company.name}</p>
      <div className="space-y-1.5 text-muted-foreground">
        <p className="flex justify-between gap-6"><span>Ventas aceptadas</span><strong className="text-foreground">{money.format(company.grossSales || 0)}</strong></p>
        <p className="flex justify-between gap-6"><span>Notas de crédito</span><strong className="text-orange-600">−{money.format(company.creditNotes || 0)}</strong></p>
        <p className="flex justify-between gap-6 border-t border-border pt-1.5"><span>Después de notas de crédito</span><strong className="text-primary">{money.format(company.netSales || 0)}</strong></p>
      </div>
    </div>
  );
}

function SkeletonDashboard() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="h-20 rounded-2xl bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-36 rounded-2xl bg-muted" />)}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="h-[420px] rounded-2xl bg-muted xl:col-span-2" />
        <div className="h-[420px] rounded-2xl bg-muted" />
      </div>
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
    mutationFn: () => api.refreshDashboard(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
  const data: any = query.data;

  const rankingChart = useMemo(() => (data?.companyRanking || []).slice(0, 6).reverse(), [data?.companyRanking]);
  const statusTotal = useMemo(
    () => (data?.statusBreakdown || []).reduce((sum: number, item: any) => sum + Number(item.count || 0), 0),
    [data?.statusBreakdown],
  );

  const choosePeriod = (next: Exclude<PeriodKey, 'custom'>) => {
    const nextRange = rangeFor(next);
    setPeriod(next);
    setFilters((current) => ({ ...current, ...nextRange }));
    setSelectedRange({ from: dateFromKey(nextRange.from), to: dateFromKey(nextRange.to) });
  };
  const chooseRange = (next: DateRange | undefined) => {
    setSelectedRange(next || {});
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
  const mixTotal = Number(summary.boletas || 0) + Number(summary.facturas || 0);
  const acceptanceRate = Number(summary.generatedDocuments || 0)
    ? (Number(summary.acceptedDocuments || 0) / Number(summary.generatedDocuments)) * 100
    : 0;
  const monthName = format(dateFromKey(filters.from), 'MMMM yyyy', { locale: es });

  return (
    <div className="space-y-5 pb-8">
      <section>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-1 rounded-xl bg-muted/60 p-1">
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

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="h-9 w-full justify-start rounded-xl bg-background px-3 text-left text-xs font-normal sm:w-[270px]"
                >
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
              <SelectTrigger className="w-full sm:w-[210px]"><SelectValue placeholder="Todas las empresas" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las empresas</SelectItem>
                {(data?.companies || []).map((company: any) => <SelectItem key={company.id} value={String(company.id)}>{company.name}</SelectItem>)}
              </SelectContent>
            </Select>

            <Button variant="outline" size="icon" onClick={() => refresh.mutate()} disabled={refresh.isPending || query.isFetching} title="Actualizar datos">
              <RefreshCw className={cn('size-4', (refresh.isPending || query.isFetching) && 'animate-spin')} />
            </Button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          title={period === 'month' ? 'Ventas aceptadas del mes' : 'Ventas aceptadas del periodo'}
          value={money.format(summary.grossSales || 0)}
          detail={`Neto después de NC: ${money.format(summary.netSales || 0)}`}
          change={data?.changes?.grossSales}
          icon={TrendingUp}
          accent
        />
        <KpiCard
          title="Tasa de aceptación SUNAT"
          value={`${acceptanceRate.toFixed(1)}%`}
          detail={`${integer.format(summary.acceptedDocuments || 0)} aceptados de ${integer.format(summary.generatedDocuments || 0)}`}
          icon={FileCheck2}
        />
        <KpiCard
          title="Ticket promedio"
          value={money.format(summary.averageTicket || 0)}
          detail="Sobre documentos aceptados"
          change={data?.changes?.averageTicket}
          icon={WalletCards}
        />
        <KpiCard
          title={`Notas de crédito ${period === 'month' ? 'del mes' : 'del periodo'}`}
          value={money.format(summary.creditNotes || 0)}
          detail={`${summary.grossSales ? ((summary.creditNotes / summary.grossSales) * 100).toFixed(1) : '0.0'}% de las ventas aceptadas`}
          icon={FileText}
        />
        <KpiCard
          title="Empresas con ventas"
          value={`${integer.format(summary.activeCompanies || 0)} / ${integer.format(data?.companies?.length || 0)}`}
          detail={`${integer.format(summary.pendingDocuments || 0)} documentos pendientes`}
          icon={Building2}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="gap-3 sm:grid-cols-[1fr_auto]">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Ventas después de notas de crédito {period === 'month' ? `· ${monthName}` : ''}</p>
              <CardTitle className="mt-1 text-2xl font-semibold tracking-tight">{money.format(summary.netSales || 0)}</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Ventas aceptadas menos notas de crédito emitidas.</p>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground sm:justify-end">
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-primary" />Después de notas de crédito</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-orange-500" />Notas de crédito</span>
            </div>
          </CardHeader>
          <CardContent className="px-2 sm:px-4">
            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data?.salesByDay || []} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.26} />
                      <stop offset="92%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 6" />
                  <XAxis dataKey="day" tickFormatter={formatDay} axisLine={false} tickLine={false} tickMargin={12} minTickGap={34} fontSize={11} stroke="var(--muted-foreground)" />
                  <YAxis orientation="right" tickFormatter={(value) => compactMoney.format(value)} axisLine={false} tickLine={false} tickMargin={10} width={66} fontSize={11} stroke="var(--muted-foreground)" />
                  <Tooltip content={<SalesTooltip />} cursor={{ stroke: 'var(--muted-foreground)', strokeDasharray: '3 4', strokeOpacity: 0.45 }} />
                  <Area type="monotone" dataKey="netSales" stroke="var(--primary)" strokeWidth={2.5} fill="url(#salesFill)" activeDot={{ r: 5, strokeWidth: 3, stroke: 'var(--background)' }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <p className="text-xs font-medium text-muted-foreground">Composición documental</p>
            <CardTitle>Boletas y facturas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative mx-auto h-[210px] max-w-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data?.documentMix || []} dataKey="value" nameKey="type" innerRadius={66} outerRadius={88} paddingAngle={3} strokeWidth={0}>
                    <Cell fill="#0ea5e9" />
                    <Cell fill="#8b5cf6" />
                  </Pie>
                  <Tooltip content={<DocumentMixTooltip />} wrapperStyle={{ zIndex: 20 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                <div><p className="text-2xl font-semibold tabular-nums">{integer.format(mixTotal)}</p><p className="text-[11px] text-muted-foreground">documentos</p></div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-sky-500/8 p-3"><p className="text-xs text-muted-foreground">Boletas</p><p className="mt-1 text-lg font-semibold text-sky-600">{integer.format(summary.boletas || 0)}</p></div>
              <div className="rounded-xl bg-violet-500/8 p-3"><p className="text-xs text-muted-foreground">Facturas</p><p className="mt-1 text-lg font-semibold text-violet-600">{integer.format(summary.facturas || 0)}</p></div>
            </div>
            <div className="mt-4 space-y-2 border-t border-border pt-4">
              {(data?.statusBreakdown || []).map((status: any) => {
                const meta = statusMeta(status.status);
                return (
                  <div key={status.status} className="flex items-center justify-between text-xs">
                    <StatusTooltip>
                      <StatusTooltipTrigger asChild>
                        <button type="button" className="inline-flex cursor-help items-center gap-2 text-muted-foreground hover:text-foreground">
                          <span className={cn('size-2 rounded-full', meta.dot)} />
                          {meta.label}
                        </button>
                      </StatusTooltipTrigger>
                      <StatusTooltipContent side="left">{meta.description}</StatusTooltipContent>
                    </StatusTooltip>
                    <strong>{integer.format(status.count)} <span className="font-normal text-muted-foreground">· {statusTotal ? ((status.count / statusTotal) * 100).toFixed(1) : 0}%</span></strong>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <p className="text-xs font-medium text-muted-foreground">Volumen operativo</p>
            <CardTitle>Documentos generados por día</CardTitle>
          </CardHeader>
          <CardContent className="px-2 sm:px-4">
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.documentsByDay || []} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 6" />
                  <XAxis dataKey="day" tickFormatter={formatDay} axisLine={false} tickLine={false} tickMargin={12} minTickGap={30} fontSize={11} stroke="var(--muted-foreground)" />
                  <YAxis orientation="right" allowDecimals={false} axisLine={false} tickLine={false} tickMargin={10} width={34} fontSize={11} stroke="var(--muted-foreground)" />
                  <Tooltip content={<DocumentsTooltip />} cursor={{ fill: 'var(--muted)', opacity: 0.6 }} />
                  <Bar dataKey="boletas" stackId="documents" fill="#0ea5e9" radius={[4, 4, 0, 0]} maxBarSize={24} />
                  <Bar dataKey="facturas" stackId="documents" fill="#8b5cf6" radius={[4, 4, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <p className="text-xs font-medium text-muted-foreground">Comparativo</p>
            <CardTitle>Empresas por ventas después de notas de crédito</CardTitle>
          </CardHeader>
          <CardContent className="px-2 sm:px-4">
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rankingChart} layout="vertical" margin={{ top: 2, right: 42, bottom: 0, left: 8 }}>
                  <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 6" />
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={118} axisLine={false} tickLine={false} fontSize={11} stroke="var(--muted-foreground)" tickFormatter={(value) => String(value).length > 17 ? `${String(value).slice(0, 16)}…` : String(value)} />
                  <Tooltip content={<CompanyRankingTooltip />} cursor={{ fill: 'var(--muted)', opacity: 0.55 }} wrapperStyle={{ zIndex: 20 }} />
                  <Bar dataKey="netSales" fill="var(--primary)" radius={[0, 6, 6, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b border-border/70 pb-5 sm:grid-cols-[1fr_auto]">
          <div>
            <CardTitle>Detalle por empresa</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Ventas, documentos y actividad del periodo seleccionado.</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CalendarDays className="size-4" />
            {data?.dataThrough ? `Datos al ${dateTimeLabel.format(new Date(data.dataThrough))}` : 'Datos actualizados'}
          </div>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Empresa</TableHead>
                <TableHead className="text-right">Ventas aceptadas</TableHead>
                <TableHead className="text-right">Notas de crédito</TableHead>
                <TableHead className="text-right">Después de notas de crédito</TableHead>
                <TableHead className="text-right">Documentos</TableHead>
                <TableHead className="text-right">Ticket promedio</TableHead>
                <TableHead className="pr-5 text-right">Días con venta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.companyRanking || []).map((company: any, index: number) => (
                <TableRow key={company.id}>
                  <TableCell className="pl-5 font-medium">
                    <span className="mr-3 inline-grid size-7 place-items-center rounded-lg bg-muted text-[11px] font-semibold text-muted-foreground">{index + 1}</span>
                    {company.name}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money.format(company.grossSales)}</TableCell>
                  <TableCell className="text-right tabular-nums text-orange-600">{company.creditNotes ? `−${money.format(company.creditNotes)}` : money.format(0)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{money.format(company.netSales)}</TableCell>
                  <TableCell className="text-right tabular-nums">{integer.format(company.documents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money.format(company.averageTicket)}</TableCell>
                  <TableCell className="pr-5 text-right tabular-nums">{integer.format(company.activeDays)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!data?.companyRanking?.length && (
            <div className="py-14 text-center text-sm text-muted-foreground"><FileCheck2 className="mx-auto mb-3 size-8 opacity-50" />No hay empresas para este filtro.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
