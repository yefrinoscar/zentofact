import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Label, Pie, PieChart, XAxis, YAxis } from 'recharts';
import { cn } from '@/lib/utils';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart';
import {
  commissionHint,
  dailySeries,
  dayKeyLabel,
  formatCompactMoney,
  formatSaleMoney,
  limaTodayKey,
  paymentMixSlices,
  percentLabel,
  productivityStats,
  salespersonKpis,
  type SalespersonDay,
  type SalespersonHome,
} from '../lib/mis-ventas-presentation';

const PAYMENT_COLORS: Record<string, string> = {
  efectivo: '#3B8F72',
  yape_plin: 'var(--primary)',
  transferencia: '#7A7672',
  despues: '#C9C5C0',
  sin_dato: '#E5E2DE',
};

const commissionChartConfig = {
  commission: { label: 'Comisión', color: 'var(--primary)' },
} satisfies ChartConfig;

const ordersChartConfig = {
  orders: { label: 'Ventas', color: '#3B8F72' },
} satisfies ChartConfig;

const paymentChartConfig = {
  total: { label: 'Vendido' },
} satisfies ChartConfig;

const integer = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 });

function pluralize(count: number, singular: string, plural: string) {
  return `${integer.format(count)} ${count === 1 ? singular : plural}`;
}

function DayTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: SalespersonDay }> }) {
  const day = payload?.[0]?.payload;
  if (!active || !day) return null;
  return (
    <div className="grid min-w-40 gap-1 rounded-xl bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/5">
      <p className="font-medium">{dayKeyLabel(day.date)}</p>
      <p className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">Comisión</span>
        <span className="font-medium tabular-nums">{formatSaleMoney(day.commission)}</span>
      </p>
      <p className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">Vendido</span>
        <span className="font-medium tabular-nums">{formatSaleMoney(day.total)}</span>
      </p>
      <p className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">Ventas</span>
        <span className="font-medium tabular-nums">{integer.format(day.orders)}</span>
      </p>
    </div>
  );
}

function ChartEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="mt-2 grid h-[148px] place-items-center rounded-md border border-dashed border-border text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

function DailyBars({
  days,
  dataKey,
  config,
  today,
  ariaLabel,
  money,
}: {
  days: SalespersonDay[];
  dataKey: 'commission' | 'orders';
  config: ChartConfig;
  today: string;
  ariaLabel: string;
  money: boolean;
}) {
  return (
    <ChartContainer
      config={config}
      className="mt-2 aspect-auto h-[148px] w-full"
      initialDimension={{ width: 640, height: 148 }}
      role="img"
      aria-label={ariaLabel}
    >
      <BarChart data={days} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} barCategoryGap="22%">
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickFormatter={dayKeyLabel}
          axisLine={false}
          tickLine={false}
          tickMargin={8}
          minTickGap={28}
          fontSize={10}
          interval="preserveStartEnd"
        />
        <YAxis
          hide={!money}
          orientation="right"
          width={44}
          axisLine={false}
          tickLine={false}
          fontSize={10}
          tickFormatter={(value) => formatCompactMoney(Number(value))}
          allowDecimals={false}
        />
        <ChartTooltip cursor={{ fill: 'var(--muted)', fillOpacity: 0.6 }} content={<DayTooltip />} />
        <Bar dataKey={dataKey} fill={`var(--color-${dataKey})`} radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false}>
          {days.map((day) => (
            <Cell key={day.date} fillOpacity={day.date === today ? 1 : 0.48} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

function PaymentDonut({ slices }: { slices: ReturnType<typeof paymentMixSlices> }) {
  const total = slices.reduce((sum, slice) => sum + slice.total, 0);
  const data = slices.map((slice) => ({ ...slice, fill: PAYMENT_COLORS[slice.key] || PAYMENT_COLORS.sin_dato }));
  return (
    <div className="mt-2 flex items-center gap-4">
      <ChartContainer
        config={paymentChartConfig}
        className="aspect-square size-[132px] min-h-[132px] min-w-[132px] max-h-[132px] max-w-[132px] shrink-0 overflow-hidden"
        initialDimension={{ width: 132, height: 132 }}
        role="img"
        aria-label={`Vendido ${formatSaleMoney(total)}: ${slices.map((slice) => `${slice.label} ${percentLabel(slice.share)}`).join(', ')}`}
      >
        <PieChart>
          <ChartTooltip
            cursor={false}
            content={({ active, payload }) => {
              const slice = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!active || !slice) return null;
              return (
                <div className="grid min-w-36 gap-1 rounded-xl bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/5">
                  <p className="font-medium">{slice.label}</p>
                  <p className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">Vendido</span>
                    <span className="font-medium tabular-nums">{formatSaleMoney(slice.total)}</span>
                  </p>
                  <p className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">Ventas</span>
                    <span className="font-medium tabular-nums">{integer.format(slice.orders)}</span>
                  </p>
                </div>
              );
            }}
          />
          <Pie
            data={data}
            dataKey="total"
            nameKey="label"
            innerRadius="64%"
            outerRadius="90%"
            paddingAngle={data.length > 1 ? 4 : 0}
            cornerRadius={4}
            stroke="none"
            startAngle={90}
            endAngle={450}
            isAnimationActive={false}
          >
            <Label
              content={({ viewBox }) => {
                if (!viewBox || !('cx' in viewBox) || !('cy' in viewBox)) return null;
                return (
                  <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                    <tspan x={viewBox.cx} y={(viewBox.cy || 0) - 6} className="fill-foreground text-[11px] font-semibold tabular-nums">
                      {formatCompactMoney(total)}
                    </tspan>
                    <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 9} className="fill-muted-foreground text-[10px]">
                      vendido
                    </tspan>
                  </text>
                );
              }}
            />
          </Pie>
        </PieChart>
      </ChartContainer>
      <ul className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs">
        {data.map((slice) => (
          <li key={slice.key} className="flex items-center gap-2">
            <span className="size-2 shrink-0 rounded-[2px]" style={{ background: slice.fill }} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{slice.label}</span>
            <span className="tabular-nums text-foreground/80">{percentLabel(slice.share)}</span>
            <span className="hidden w-20 text-right font-medium tabular-nums sm:inline">{formatSaleMoney(slice.total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Hero({ label, value, detail, emphasis }: { label: string; value: string; detail: string; emphasis?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn(
        'mt-1 truncate font-semibold tabular-nums tracking-tight',
        emphasis ? 'text-2xl text-primary sm:text-[1.7rem]' : 'text-xl sm:text-2xl',
      )}>
        {value}
      </p>
      <p className="mt-1 truncate text-xs leading-snug text-muted-foreground">{detail}</p>
    </div>
  );
}

function SkeletonStrip() {
  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]" aria-hidden>
      {[0, 1, 2].map((index) => (
        <div key={index} className="animate-pulse space-y-3">
          <div className="h-3 w-24 rounded bg-muted" />
          <div className="h-7 w-32 rounded bg-muted" />
          <div className="h-3 w-40 rounded bg-muted" />
          <div className="h-[148px] rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

export function MisVentasCharts({ home, loading }: { home?: SalespersonHome | null; loading: boolean }) {
  if (loading && !home) return <SkeletonStrip />;

  const [today, month] = salespersonKpis(home);
  const days = dailySeries(home);
  const stats = productivityStats(days);
  const slices = paymentMixSlices(home?.paymentMix);
  const todayKey = limaTodayKey();
  const windowLabel = stats.days > 0 ? `${stats.days} días` : '30 días';
  const hasWindowSales = stats.orders > 0;

  return (
    <section
      aria-label="Indicadores personales"
      className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]"
    >
      <div className="min-w-0">
        <div className="grid grid-cols-2 gap-4">
          <Hero
            label="Comisión hoy"
            value={formatSaleMoney(today.commission)}
            detail={`${pluralize(today.orders, 'venta', 'ventas')} · ${formatSaleMoney(today.total)} vendido`}
            emphasis
          />
          <Hero
            label="Comisión del mes"
            value={formatSaleMoney(month.commission)}
            detail={`${pluralize(month.orders, 'venta', 'ventas')} · ${formatSaleMoney(month.total)} vendido`}
            emphasis
          />
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          {commissionHint(home?.commissionPercent)} Comisión por día, últimos {windowLabel}.
        </p>
        {hasWindowSales ? (
          <DailyBars
            days={days}
            dataKey="commission"
            config={commissionChartConfig}
            today={todayKey}
            money
            ariaLabel={`Comisión por día, últimos ${windowLabel}: ${formatSaleMoney(stats.commission)} en total`}
          />
        ) : <ChartEmpty>Sin ventas en los últimos {windowLabel}.</ChartEmpty>}
      </div>

      <div className="min-w-0">
        <Hero
          label="Ventas por día"
          value={pluralize(stats.orders, 'venta', 'ventas')}
          detail={hasWindowSales
            ? `${pluralize(stats.activeDays, 'día con venta', 'días con venta')} · ${decimal.format(stats.ordersPerActiveDay)} por día`
            : `Ninguna en ${windowLabel}.`}
        />
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          {stats.bestDay
            ? `Mejor día: ${dayKeyLabel(stats.bestDay.date)} · ${formatSaleMoney(stats.bestDay.total)}.`
            : `Últimos ${windowLabel}.`}
        </p>
        {hasWindowSales ? (
          <DailyBars
            days={days}
            dataKey="orders"
            config={ordersChartConfig}
            today={todayKey}
            money={false}
            ariaLabel={`Ventas por día, últimos ${windowLabel}: ${integer.format(stats.orders)} ventas en ${integer.format(stats.activeDays)} días`}
          />
        ) : <ChartEmpty>Sin ventas en los últimos {windowLabel}.</ChartEmpty>}
      </div>

      <div className="min-w-0">
        <Hero
          label="Cómo te pagan"
          value={formatSaleMoney(stats.averageTicket)}
          detail={hasWindowSales ? `Ticket promedio · ${formatSaleMoney(stats.total)} vendido` : 'Ticket promedio'}
        />
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          {slices.some((slice) => slice.key === 'despues')
            ? `${percentLabel(slices.find((slice) => slice.key === 'despues')!.share)} se cobra después.`
            : `Medios de pago, últimos ${windowLabel}.`}
        </p>
        {slices.length ? <PaymentDonut slices={slices} /> : <ChartEmpty>Sin cobros en los últimos {windowLabel}.</ChartEmpty>}
      </div>
    </section>
  );
}
