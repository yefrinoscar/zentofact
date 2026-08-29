import { useMemo, useState } from 'react';
import { Liveline, type LivelinePoint, type LivelineSeries } from 'liveline';
import {
  livelinePointsFromValues,
  money,
  percentLabel,
  settlementCharts,
  settlementDailySeries,
} from '../lib/pagos-presentation';
import { cn } from '@/lib/utils';

const LINE_COLOR = {
  facturado: '#6f6d66',
  neto: '#059669',
  commission: '#dc2626',
  shipping: '#d97706',
  paid: '#059669',
  pending: '#d97706',
} as const;

const LLEGA = 'text-emerald-700 dark:text-emerald-400';
const TAKE = 'text-red-600 dark:text-red-400';
const WAIT = 'text-amber-800 dark:text-amber-400';
const SPAN_SECS = 48;

type Tone = 'neutral' | 'receive' | 'take' | 'wait';
type ChartItem = { key: string; label: string; value: number; tone?: Tone };
type DayRow = Record<string, number | string>;

function toneClass(tone?: Tone) {
  if (tone === 'receive') return LLEGA;
  if (tone === 'take') return TAKE;
  if (tone === 'wait') return WAIT;
  return '';
}

function seriesFromDays(days: DayRow[], key: keyof typeof LINE_COLOR, label: string): LivelineSeries {
  const values = days.length ? days.map((day) => Number(day[key] || 0)) : [0];
  const data = livelinePointsFromValues(values, SPAN_SECS);
  return {
    id: key,
    label,
    data,
    value: data.at(-1)?.value ?? 0,
    color: LINE_COLOR[key],
  };
}

function MetricHeader({ items, hint }: { items: ChartItem[]; hint: string }) {
  return (
    <>
      <div className="flex items-start gap-4">
        {items.map((item) => (
          <div key={item.key} className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: LINE_COLOR[item.key as keyof typeof LINE_COLOR] }}
              />
              {item.label}
            </p>
            <p className={cn('text-[17px] font-semibold tabular-nums tracking-[-0.01em] leading-tight', toneClass(item.tone))}>
              {money.format(item.value)}
            </p>
          </div>
        ))}
      </div>
      {hint ? <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
    </>
  );
}

function CompareLines({ days, items }: { days: DayRow[]; items: ChartItem[] }) {
  const series = useMemo(
    () => items.map((item) => seriesFromDays(days, item.key as keyof typeof LINE_COLOR, item.label)),
    [days, items],
  );
  return (
    <div className="mt-2 h-[148px]">
      <Liveline
        data={[]}
        value={0}
        series={series}
        theme="light"
        grid={false}
        badge={false}
        pulse={false}
        window={SPAN_SECS}
        paused
        scrub
        cursor="crosshair"
        lineWidth={2.25}
        padding={{ top: 28, right: 8, bottom: 18, left: 8 }}
        formatValue={(value) => money.format(value)}
      />
    </div>
  );
}

function FocusLine({ days, items }: { days: DayRow[]; items: ChartItem[] }) {
  const [metric, setMetric] = useState(items[0]?.key || 'commission');
  const selected = items.find((item) => item.key === metric) ?? items[0];
  const points = useMemo<LivelinePoint[]>(() => {
    const values = days.length ? days.map((day) => Number(day[metric] || 0)) : [0];
    return livelinePointsFromValues(values, SPAN_SECS);
  }, [days, metric]);
  const value = points.at(-1)?.value ?? selected?.value ?? 0;
  const color = LINE_COLOR[metric as keyof typeof LINE_COLOR] || LINE_COLOR.commission;
  return (
    <div className="mt-2">
      <div className="mb-1 flex justify-end">
        <span className="flex rounded-full bg-muted p-0.5">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={metric === item.key}
              onClick={() => setMetric(item.key)}
              className={cn(
                'rounded-full px-2 py-0.5 text-[10.5px] font-medium transition-colors',
                metric === item.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {item.label}
            </button>
          ))}
        </span>
      </div>
      <div className="h-[128px]">
        <Liveline
          data={points}
          value={value}
          theme="light"
          color={color}
          grid
          badge={false}
          pulse={false}
          fill
          window={SPAN_SECS}
          paused
          scrub
          cursor="crosshair"
          lineWidth={2.25}
          padding={{ top: 28, right: 8, bottom: 18, left: 8 }}
          formatValue={(next) => money.format(next)}
        />
      </div>
    </div>
  );
}

function AllocationBar({ items }: { items: ChartItem[] }) {
  const [active, setActive] = useState(items[0]?.key || 'paid');
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return (
    <div className="mt-3">
      <div className="flex h-9 gap-0.5 overflow-hidden rounded-full bg-muted p-0.5" role="group" aria-label="Depósito">
        {items.map((item) => {
          const width = total ? Math.max((item.value / total) * 100, item.value ? 8 : 0) : 50;
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={active === item.key}
              aria-label={`${item.label}: ${money.format(item.value)}`}
              onClick={() => setActive(item.key)}
              className="relative h-full overflow-hidden rounded-full transition-opacity"
              style={{
                width: `${width}%`,
                background: LINE_COLOR[item.key as keyof typeof LINE_COLOR],
                opacity: active === item.key ? 1 : 0.55,
              }}
            />
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={active === item.key}
            onClick={() => setActive(item.key)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums transition-colors',
              active === item.key ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="size-1.5 rounded-full" style={{ background: LINE_COLOR[item.key as keyof typeof LINE_COLOR] }} />
            {item.label} {percentLabel(total ? item.value / total : null)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SettlementKpiStrip({ summary, sales }: {
  summary?: {
    saleCount?: number;
    bruto?: number | null;
    neto?: number | null;
    take?: number | null;
    commission?: number | null;
    shipping?: number | null;
    paidNeto?: number | null;
    pendingNeto?: number | null;
    paidCount?: number | null;
    pendingCount?: number | null;
    takeRate?: number | null;
    matchedCount?: number | null;
  } | null;
  sales?: Array<{
    date?: string | null;
    paid?: boolean;
    bruto?: number | null;
    neto?: number | null;
    commission?: number | null;
    shipping?: number | null;
  }>;
}) {
  if (!summary?.saleCount) return null;
  const charts = settlementCharts(summary);
  const days = settlementDailySeries(sales);
  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-3">
      {charts.map((chart) => {
        const caption = chart.items.map((item) => `${item.label} ${money.format(item.value)}`).join(', ');
        return (
          <div key={chart.id} aria-label={caption}>
            <MetricHeader items={chart.items} hint={chart.hint} />
            {chart.kind === 'compare' ? <CompareLines days={days} items={chart.items} /> : null}
            {chart.kind === 'focus' ? <FocusLine days={days} items={chart.items} /> : null}
            {chart.kind === 'allocation' ? <AllocationBar items={chart.items} /> : null}
          </div>
        );
      })}
    </div>
  );
}
