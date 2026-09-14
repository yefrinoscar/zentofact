import { useState } from 'react';
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '../lib/cn';
import { formatSalesCount, formatSalesMoney, type SalesDayPoint } from '../lib/product-sales-presentation';
import { Skeleton } from './ui/skeleton';

type Metric = 'revenue' | 'units';
const dayLabel = new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fullDayLabel = new Intl.DateTimeFormat('es-PE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const compactNumber = new Intl.NumberFormat('es-PE', { notation: 'compact', maximumFractionDigits: 1 });
const weekdays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const parseDate = (date: string) => new Date(`${date}T12:00:00Z`);

export function SalesOverview({ daily, loading }: { daily: SalesDayPoint[]; loading: boolean }) {
  const [metric, setMetric] = useState<Metric>('revenue');
  const formatValue = (value: number) => metric === 'revenue' ? formatSalesMoney(value) : `${formatSalesCount(value)} u`;
  const ordered = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  const series = ordered.map((point, index) => ({
    ...point,
    value: point[metric],
    average: index < 6 ? null : ordered.slice(index - 6, index + 1).reduce((sum, item) => sum + item[metric], 0) / 7,
  }));
  const total = series.reduce((sum, point) => sum + point.value, 0);
  let accumulated = 0;
  const accumulatedSeries = ordered.map((point) => {
    accumulated += point.revenue;
    return { ...point, accumulated };
  });
  const average = series.length ? total / series.length : 0;
  const peak = series.reduce<(typeof series)[number] | undefined>((best, point) => !best || point.value > best.value ? point : best, undefined);
  const week = weekdays.map((label, index) => {
    const days = series.filter((point) => (parseDate(point.date).getUTCDay() + 6) % 7 === index);
    return { label, count: days.length, value: days.length ? days.reduce((sum, point) => sum + point.value, 0) / days.length : 0 };
  });
  const bestWeekday = week.reduce((best, day) => day.value > best.value ? day : best, week[0]);
  const hasSales = ordered.some((point) => point.revenue > 0 || point.units > 0);

  if (loading) return <Skeleton className="h-[390px] w-full" />;

  return (
    <section className="min-w-0 rounded-lg border border-border bg-background" aria-label="Ventas del periodo">
      <div className="flex flex-wrap items-start justify-between gap-4 px-4 pt-5 sm:px-6">
        <div>
          <h2 className="text-sm font-semibold">Ventas del periodo</h2>
          <p className="mt-1 text-xs text-muted-foreground">Todos los canales · según los filtros seleccionados</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Métrica del gráfico">
          {([{ key: 'revenue', label: 'Soles' }, { key: 'units', label: 'Unidades' }] satisfies { key: Metric; label: string }[]).map((option) => (
            <button key={option.key} type="button" aria-pressed={metric === option.key} onClick={() => setMetric(option.key)}
              className={cn('daisy-btn daisy-btn-xs daisy-btn-ghost h-7 rounded-md border-0 px-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2', metric === option.key && 'bg-background shadow-sm')}>
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {!hasSales ? <div className="grid h-64 place-items-center px-6 text-sm text-muted-foreground">Sin ventas en este periodo.</div> : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 px-4 sm:flex sm:gap-10 sm:px-6">
            <div><dt className="text-xs text-muted-foreground">{metric === 'revenue' ? 'Venta total' : 'Unidades vendidas'}</dt><dd className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{formatValue(total)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Promedio diario</dt><dd className="mt-1 text-lg font-medium tabular-nums">{formatValue(average)}</dd></div>
            {peak && <div><dt className="text-xs text-muted-foreground">Mejor día · {dayLabel.format(parseDate(peak.date))}</dt><dd className="mt-1 text-lg font-medium tabular-nums">{formatValue(peak.value)}</dd></div>}
          </dl>
          <div className="mt-4 grid min-w-0 sm:grid-cols-2 xl:grid-cols-4">
            <div className="min-w-0 border-t border-border px-2 py-4 sm:px-4">
              <h3 className="px-2 text-xs font-semibold">{metric === 'revenue' ? 'Ventas diarias' : 'Unidades diarias'}</h3>
              <div className="mb-2 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-2 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-sky-500" />{metric === 'revenue' ? 'Venta diaria' : 'Unidades por día'}</span>
                {series.length >= 7 && <span className="flex items-center gap-2"><span className="h-0.5 w-4 bg-sky-800 dark:bg-sky-200" />Media 7 días</span>}
              </div>
              <div className="h-40 w-full" role="img" aria-label={`Ventas diarias. Total ${formatValue(total)}, promedio diario ${formatValue(average)}. Usa las flechas del gráfico para explorar cada día.`}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart accessibilityLayer data={series} margin={{ top: 12, right: 12, bottom: 0, left: 0 }} barCategoryGap="28%">
                    <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" />
                    <XAxis dataKey="date" tickFormatter={(value: string) => dayLabel.format(parseDate(value))} axisLine={false} tickLine={false} tickMargin={12} minTickGap={36} fontSize={11} stroke="var(--muted-foreground)" />
                    <YAxis domain={[0, 'auto']} tickFormatter={(value: number) => `${metric === 'revenue' ? 'S/ ' : ''}${compactNumber.format(value)}`} width={58} axisLine={false} tickLine={false} tickMargin={8} tickCount={4} allowDecimals={metric === 'revenue'} fontSize={10} stroke="var(--muted-foreground)" />
                    <Tooltip cursor={{ fill: 'var(--muted)', opacity: 0.6 }} content={({ active, label }) => {
                      const point = series.find((item) => item.date === label);
                      if (!active || !point) return null;
                      return <div className="min-w-48 rounded-lg border border-border bg-popover p-3 text-xs text-popover-foreground shadow-lg">
                        <p className="mb-3 font-medium capitalize">{fullDayLabel.format(parseDate(point.date))}</p>
                        <div className="flex justify-between gap-5"><span className="text-muted-foreground">Ventas</span><strong className="tabular-nums">{formatSalesMoney(point.revenue)}</strong></div>
                        <div className="mt-2 flex justify-between gap-5"><span className="text-muted-foreground">Unidades</span><strong className="tabular-nums">{formatSalesCount(point.units)}</strong></div>
                        {point.average !== null && <div className="mt-3 flex justify-between gap-5 border-t border-border pt-2"><span className="text-muted-foreground">Promedio de 7 días</span><span className="tabular-nums">{formatValue(point.average)}</span></div>}
                        {point.date === peak?.date && <p className="mt-2 font-medium text-amber-700 dark:text-amber-400">Mayor venta del periodo</p>}
                      </div>;
                    }} />
                    <Bar dataKey="value" name="Venta diaria" maxBarSize={32} radius={[3, 3, 0, 0]} isAnimationActive={false}>
                      {series.map((point) => <Cell key={point.date} fill={point.date === peak?.date ? '#f59e0b' : '#0ea5e9'} fillOpacity={point.date === peak?.date ? 1 : 0.65} />)}
                    </Bar>
                    <Line type="linear" dataKey="average" className="text-sky-800 dark:text-sky-200" stroke="currentColor" strokeWidth={2.5} dot={false} activeDot={{ r: 4, stroke: 'var(--background)', strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
            <CompactSalesChart title="Ventas acumuladas" subtitle="Cuánto llevas vendido en el periodo" data={accumulatedSeries} dataKey="accumulated" color="#059669" money area />
            <CompactSalesChart title="Unidades vendidas" subtitle="Volumen diario de productos" data={ordered} dataKey="units" color="#8b5cf6" />
            <div className="border-t border-border px-5 py-4 sm:border-l">
              <h3 className="text-xs font-semibold">¿Qué días se vende más?</h3>
              <p className="mt-1 text-[11px] text-muted-foreground">Promedio por día de la semana</p>
              <div className="mt-3 space-y-2">
                {week.map((day) => <div key={day.label} className="grid grid-cols-[24px_minmax(0,1fr)_76px] items-center gap-2 text-[11px]" aria-label={`${day.label}: ${day.count ? formatValue(day.value) : 'sin datos'}`}>
                  <span className={cn('text-muted-foreground', day.label === bestWeekday?.label && 'font-semibold text-foreground')}>{day.label}</span>
                  <div className="h-2 overflow-hidden rounded-sm bg-muted"><div className={cn('h-full rounded-sm bg-sky-500/45', day.label === bestWeekday?.label && 'bg-sky-600')} style={{ width: `${bestWeekday?.value ? day.value / bestWeekday.value * 100 : 0}%` }} /></div>
                  <span className="text-right tabular-nums">{day.count ? formatValue(day.value) : '—'}</span>
                </div>)}
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">Incluye días sin ventas.</p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function CompactSalesChart({ title, subtitle, data, dataKey, color, money = false, area = false }: {
  title: string;
  subtitle: string;
  data: (SalesDayPoint & { accumulated?: number })[];
  dataKey: 'accumulated' | 'units';
  color: string;
  money?: boolean;
  area?: boolean;
}) {
  return <div className={cn('min-w-0 border-t border-border px-4 py-4', area ? 'sm:border-l' : 'xl:border-l')}>
    <h3 className="text-xs font-semibold">{title}</h3>
    <p className="mb-2 mt-2 text-[10px] text-muted-foreground">{subtitle}</p>
    <div className="h-40 w-full" aria-label={title}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart accessibilityLayer data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" />
          <XAxis dataKey="date" tickFormatter={(value: string) => dayLabel.format(parseDate(value))} axisLine={false} tickLine={false} minTickGap={32} tickMargin={12} fontSize={10} stroke="var(--muted-foreground)" />
          <YAxis width={money ? 58 : 32} tickCount={4} allowDecimals={money} tickFormatter={(value: number) => `${money ? 'S/ ' : ''}${compactNumber.format(value)}`} axisLine={false} tickLine={false} fontSize={10} stroke="var(--muted-foreground)" />
          <Tooltip content={({ active, label }) => {
            const point = data.find((item) => item.date === label);
            const value = point?.[dataKey];
            if (!active || !point || value === undefined) return null;
            return <div className="rounded-lg border border-border bg-popover p-3 text-xs text-popover-foreground shadow-lg">
              <p className="font-medium">{dayLabel.format(parseDate(point.date))}</p>
              <p className="mt-2 tabular-nums">{title}: {money ? formatSalesMoney(value) : `${formatSalesCount(value)} u`}</p>
            </div>;
          }} />
          {area ? <Area type="linear" dataKey={dataKey} stroke={color} fill={color} fillOpacity={0.1} strokeWidth={2} isAnimationActive={false} />
            : <Bar dataKey={dataKey} fill={color} fillOpacity={0.65} radius={[2, 2, 0, 0]} maxBarSize={18} isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  </div>;
}
