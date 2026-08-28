import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  ChartNoAxesCombined,
  CircleDollarSign,
  RefreshCw,
  ShoppingBag,
  Store,
  WalletCards,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
} from 'recharts';
import type { TreemapNode } from 'recharts';
import api from '../lib/api';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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

type CompanyPerformance = {
  id: number;
  name: string;
  netSales: number;
  cancelledSales: number;
  orders: number;
  cancelledOrders: number;
  totalOrders: number;
  previousNetSales: number;
  averageTicket: number;
  salesShare: number;
  salesChange: number | null;
  cancellationRate: number;
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
    return `${format(start, 'd', { locale: es })} - ${format(end, "d 'de' MMMM 'de' yyyy", { locale: es })}`;
  }
  return `${format(start, 'd MMM yyyy', { locale: es })} - ${format(end, 'd MMM yyyy', { locale: es })}`;
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

function periodDays(from: string, to: string) {
  const start = new Date(`${from}T12:00:00.000Z`).getTime();
  const end = new Date(`${to}T12:00:00.000Z`).getTime();
  return Math.round((end - start) / 86_400_000) + 1;
}

function Trend({ value, inverse = false }: { value: number | null | undefined; inverse?: boolean }) {
  if (value === undefined) return null;
  if (value === null) return <span className="font-medium text-muted-foreground">Sin base previa</span>;
  const rising = value >= 0;
  const favorable = inverse ? !rising : rising;
  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 font-semibold',
      favorable ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
    )}>
      {rising ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function KpiCard({
  title,
  value,
  detail,
  change,
  icon: Icon,
  warning = false,
}: {
  title: string;
  value: string;
  detail: string;
  change?: number | null;
  icon: typeof ShoppingBag;
  warning?: boolean;
}) {
  return (
    <Card className="gap-4 py-5">
      <CardContent className="px-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{title}</p>
            <p className={cn(
              'mt-2 whitespace-nowrap text-[1.35rem] font-semibold tracking-[-0.035em] tabular-nums 2xl:text-2xl',
              warning && 'text-orange-600 dark:text-orange-400',
            )}>
              {value}
            </p>
          </div>
          <span className={cn(
            'grid size-9 shrink-0 place-items-center rounded-xl',
            warning ? 'bg-orange-500/10 text-orange-600' : 'bg-primary/8 text-primary dark:bg-primary/15',
          )}>
            <Icon className="size-[18px]" />
          </span>
        </div>
        <div className="mt-4 flex min-h-4 items-center justify-between gap-2 text-xs">
          <span className="truncate text-muted-foreground">{detail}</span>
          <Trend value={change} inverse={warning} />
        </div>
      </CardContent>
    </Card>
  );
}

function SalesSummaryCard({ summary, change }: { summary: any; change?: number | null }) {
  return (
    <Card className="gap-0 bg-primary py-5 text-primary-foreground ring-primary/20">
      <CardContent className="px-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-primary-foreground/70">Vendimos</p>
            <p className="mt-2 whitespace-nowrap text-[1.55rem] font-semibold tracking-[-0.04em] tabular-nums 2xl:text-[1.7rem]">
              {money.format(summary.netSales || 0)}
            </p>
          </div>
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/12 text-white">
            <CircleDollarSign className="size-[18px]" />
          </span>
        </div>
        <div className="mt-4 flex items-center justify-between gap-2 text-xs">
          <span className="text-primary-foreground/65">Te llega {money.format(summary.arrives || 0)}</span>
          {change === null ? (
            <span className="font-medium text-primary-foreground/65">Sin base previa</span>
          ) : (
            <span className="inline-flex items-center gap-0.5 font-semibold text-white">
              {(change || 0) >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
              {Math.abs(change || 0).toFixed(1)}%
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SalesTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  return (
    <div className="min-w-56 rounded-xl border border-border/80 bg-popover/95 p-3 text-xs shadow-xl backdrop-blur">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-6">
          <span className="text-muted-foreground">{formatDay(row.day)}</span>
          <strong className="text-primary">{money.format(row.netSales || 0)}</strong>
        </div>
        <div className="flex items-center justify-between gap-6">
          <span className="text-muted-foreground">{formatDay(row.previousDay)}</span>
          <strong>{money.format(row.previousSales || 0)}</strong>
        </div>
        <div className="flex items-center justify-between gap-6 border-t border-border pt-2">
          <span className="text-muted-foreground">Pedidos del día</span>
          <strong>{integer.format(row.orders || 0)}</strong>
        </div>
      </div>
    </div>
  );
}

function CompanyTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const company = payload[0]?.payload as CompanyPerformance;
  return (
    <div className="min-w-60 rounded-xl border border-border/80 bg-popover/95 p-3 text-xs shadow-xl backdrop-blur">
      <p className="mb-2 max-w-64 font-medium text-foreground">{company.name}</p>
      <div className="space-y-1.5 text-muted-foreground">
        <p className="flex justify-between gap-6"><span>Ventas netas</span><strong className="text-primary">{money.format(company.netSales)}</strong></p>
        <p className="flex justify-between gap-6"><span>Participación</span><strong className="text-foreground">{company.salesShare.toFixed(1)}%</strong></p>
        <p className="flex justify-between gap-6"><span>Ticket promedio</span><strong className="text-foreground">{money.format(company.averageTicket)}</strong></p>
        <p className="flex justify-between gap-6 border-t border-border pt-1.5"><span>Cancelaciones</span><strong className="text-orange-600">{money.format(company.cancelledSales)}</strong></p>
      </div>
    </div>
  );
}

function CompanyTreemapCell({ depth, x, y, width, height, index, name, salesShare, netSales }: TreemapNode) {
  if (depth !== 1 || width < 4 || height < 4) return null;

  const share = Number(salesShare || 0);
  const sales = Number(netSales || 0);
  const showName = width >= 86 && height >= 52;
  const showAmount = width >= 105 && height >= 78;
  const maxNameLength = Math.max(8, Math.floor((width - 24) / 6.2));
  const shortName = name.length > maxNameLength ? `${name.slice(0, maxNameLength - 1)}…` : name;
  const radius = Math.min(8, width / 8, height / 8);

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={radius}
        fill="var(--primary)"
        fillOpacity={Math.max(0.7, 1 - index * 0.045)}
      />
      {showName && (
        <text x={x + 12} y={y + 20} fill="var(--primary-foreground)" fontSize={10} fontWeight={650}>
          {index + 1}. {shortName}
        </text>
      )}
      {width >= 54 && height >= 38 && (
        <text
          x={x + 12}
          y={showAmount ? y + height - 29 : y + height - 13}
          fill="var(--primary-foreground)"
          fontSize={showAmount ? 18 : 13}
          fontWeight={750}
        >
          {share.toFixed(1)}%
        </text>
      )}
      {showAmount && (
        <text x={x + 12} y={y + height - 11} fill="var(--primary-foreground)" fillOpacity={0.74} fontSize={10}>
          {compactMoney.format(sales)}
        </text>
      )}
    </g>
  );
}

function SkeletonDashboard() {
  return (
    <div className="animate-pulse space-y-5">
      <div className="h-20 rounded-2xl bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-36 rounded-2xl bg-muted" />)}
      </div>
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="h-[420px] rounded-2xl bg-muted xl:col-span-3" />
        <div className="h-[420px] rounded-2xl bg-muted xl:col-span-2" />
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
    mutationFn: () => api.syncOrdersInbox(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
  const data: any = query.data;

  const ranking = useMemo(
    () => (data?.companyRanking || []).filter((company: CompanyPerformance) => company.totalOrders > 0),
    [data?.companyRanking],
  );
  const rankingChart = ranking;

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
  const days = periodDays(filters.from, filters.to);
  const comparisonLabel = `vs. ${rangeLabel(data?.filters?.previousFrom || filters.from, data?.filters?.previousTo || filters.to)}`;

  return (
    <div className="space-y-5 pb-8">
      <section className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
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
              <Button variant="outline" className="h-9 w-full justify-start rounded-xl bg-background px-3 text-left text-xs font-normal sm:w-[270px]">
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
            <SelectTrigger className="w-full sm:w-[210px]"><SelectValue placeholder="Todas las tiendas" /></SelectTrigger>
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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SalesSummaryCard summary={summary} change={data?.changes?.netSales} />
        <KpiCard
          title="Pagado"
          value={money.format(summary.paidSales || 0)}
          detail="Ya depositaron"
          icon={CircleDollarSign}
        />
        <KpiCard
          title="Pendiente"
          value={money.format(summary.pendingSales || 0)}
          detail="Aún no pagan"
          icon={WalletCards}
        />
        <KpiCard
          title="Pedidos vendidos"
          value={integer.format(summary.orders || 0)}
          detail={`${(Number(summary.orders || 0) / days).toFixed(1)} pedidos por día`}
          change={data?.changes?.orders}
          icon={ShoppingBag}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader className="gap-3 sm:grid-cols-[1fr_auto]">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Evolución financiera</p>
              <CardTitle className="mt-1 text-xl font-semibold tracking-tight">Ventas netas por día</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Compara el ritmo de ventas con el periodo inmediatamente anterior.</p>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground sm:justify-end">
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-primary" />Periodo actual</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-muted-foreground/60" />Periodo anterior</span>
            </div>
          </CardHeader>
          <CardContent className="px-2 sm:px-4">
            <div className="h-[330px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data?.salesByDay || []} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.24} />
                      <stop offset="92%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 6" />
                  <XAxis dataKey="day" tickFormatter={formatDay} axisLine={false} tickLine={false} tickMargin={12} minTickGap={34} fontSize={11} stroke="var(--muted-foreground)" />
                  <YAxis orientation="right" tickFormatter={(value) => compactMoney.format(value)} axisLine={false} tickLine={false} tickMargin={10} width={66} fontSize={11} stroke="var(--muted-foreground)" />
                  <Tooltip content={<SalesTooltip />} cursor={{ stroke: 'var(--muted-foreground)', strokeDasharray: '3 4', strokeOpacity: 0.45 }} />
                  <Line type="monotone" dataKey="previousSales" stroke="var(--muted-foreground)" strokeOpacity={0.55} strokeWidth={1.75} strokeDasharray="5 5" dot={false} activeDot={false} />
                  <Area type="monotone" dataKey="netSales" stroke="var(--primary)" strokeWidth={2.5} fill="url(#salesFill)" activeDot={{ r: 5, strokeWidth: 3, stroke: 'var(--background)' }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <p className="text-xs font-medium text-muted-foreground">Comparativo de tiendas</p>
            <CardTitle className="text-xl font-semibold tracking-tight">Aporte a las ventas</CardTitle>
            <p className="text-xs text-muted-foreground">Ingreso neto y participación en el periodo seleccionado.</p>
          </CardHeader>
          <CardContent className="px-2 sm:px-4">
            {rankingChart.length ? (
              <div
                key={`${filters.from}-${filters.to}-${filters.companyId || 'all'}`}
                className="h-[330px] w-full overflow-hidden rounded-xl motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <Treemap
                    data={rankingChart}
                    dataKey="netSales"
                    nameKey="name"
                    aspectRatio={4 / 3}
                    nodeGap={4}
                    isAnimationActive={false}
                    content={(props) => <CompanyTreemapCell {...props} />}
                  >
                    <Tooltip content={<CompanyTooltip />} wrapperStyle={{ zIndex: 20 }} />
                  </Treemap>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="grid h-[330px] place-items-center text-center text-sm text-muted-foreground">
                <div>
                  <Store className="mx-auto mb-3 size-8 opacity-50" />
                  No hay ventas para comparar.
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b border-border/70 pb-5 sm:grid-cols-[1fr_auto]">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Desempeño comercial</p>
            <CardTitle className="mt-1 text-xl font-semibold tracking-tight">Salud financiera por tienda</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Identifica qué tiendas crecen, cuánto aportan y dónde se concentra la cancelación.</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CalendarDays className="size-4" />
            {data?.dataThrough ? `Ventas sincronizadas al ${dateTimeLabel.format(new Date(data.dataThrough))}` : comparisonLabel}
          </div>
        </CardHeader>
        <CardContent className="px-0">
          <Table className="min-w-[940px]">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Tienda</TableHead>
                <TableHead className="text-right">Ventas netas</TableHead>
                <TableHead>Participación</TableHead>
                <TableHead className="text-right">Vs. anterior</TableHead>
                <TableHead className="text-right">Pedidos</TableHead>
                <TableHead className="text-right">Ticket promedio</TableHead>
                <TableHead className="pr-5 text-right">Cancelaciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ranking.map((company: CompanyPerformance, index: number) => (
                <TableRow key={company.id}>
                  <TableCell className="pl-5 font-medium">
                    <span className="mr-3 inline-grid size-7 place-items-center rounded-lg bg-muted text-[11px] font-semibold text-muted-foreground">{index + 1}</span>
                    {company.name}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{money.format(company.netSales)}</TableCell>
                  <TableCell>
                    <div className="flex min-w-32 items-center gap-3">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(company.salesShare, 100)}%` }} />
                      </div>
                      <span className="w-11 text-right text-xs tabular-nums text-muted-foreground">{company.salesShare.toFixed(1)}%</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right"><Trend value={company.salesChange} /></TableCell>
                  <TableCell className="text-right tabular-nums">{integer.format(company.orders)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money.format(company.averageTicket)}</TableCell>
                  <TableCell className="pr-5 text-right">
                    <p className="tabular-nums text-orange-600 dark:text-orange-400">{money.format(company.cancelledSales)}</p>
                    <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">{company.cancellationRate.toFixed(1)}% de pedidos</p>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!ranking.length && (
            <div className="py-14 text-center text-sm text-muted-foreground">
              <Store className="mx-auto mb-3 size-8 opacity-50" />
              No hay ventas sincronizadas para este periodo.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <ChartNoAxesCombined className="size-4" />
        Vendimos es lo que pagó el cliente. Pagado y pendiente es lo que te llega. {comparisonLabel}.
      </div>
    </div>
  );
}
