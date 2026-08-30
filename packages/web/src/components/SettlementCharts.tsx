import { useState } from 'react';
import { Liveline, type LivelineSeries } from 'liveline';
import {
  formatLivelineDay,
  livelinePointsFromDays,
  livelineWindowSecs,
  money,
  percentLabel,
  settlementCharts,
  settlementDailySeries,
} from '../lib/pagos-presentation';
import { cn } from '@/lib/utils';

const LINE_COLOR = {
  facturado: '#7A7672',
  neto: '#3B8F72',
  commission: '#7A72E3',
  shipping: '#E07838',
  take: '#5C57A8',
  paid: '#3B8F72',
  pending: '#E07838',
} as const;

type Tone = 'neutral' | 'receive' | 'take' | 'wait';
type ChartItem = { key: string; label: string; value: number; tone?: Tone };
type DayRow = Record<string, number | string>;

function seriesColor(key: string) {
  return LINE_COLOR[key as keyof typeof LINE_COLOR] || LINE_COLOR.take;
}

function seriesFromDays(days: DayRow[], key: keyof typeof LINE_COLOR, label: string): LivelineSeries {
  const data = livelinePointsFromDays(days, key);
  return {
    id: key,
    label,
    data,
    value: data.at(-1)?.value ?? 0,
    color: LINE_COLOR[key],
  };
}

function MetricDot({ itemKey }: { itemKey: string }) {
  return (
    <span
      className="size-2 shrink-0 rounded-[2px]"
      style={{ background: seriesColor(itemKey) }}
    />
  );
}

function MetricHeader({
  hero,
  items,
  hint,
}: {
  hero?: ChartItem;
  items: ChartItem[];
  hint: string;
}) {
  const lead = hero ? [hero] : items.slice(0, 2);
  return (
    <>
      <div className={cn('flex items-start gap-4', hero && 'flex-col gap-0')}>
        {lead.map((item) => (
          <div key={item.key} className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <MetricDot itemKey={item.key} />
              {item.label}
            </p>
            <p
              className="text-[17px] font-semibold tabular-nums tracking-[-0.01em] leading-tight"
              style={{ color: seriesColor(item.key) }}
            >
              {money.format(item.value)}
            </p>
          </div>
        ))}
      </div>
      {hint ? <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
    </>
  );
}

function MultiSeriesChart({ series }: { series: LivelineSeries[] }) {
  const windowSecs = livelineWindowSecs(series[0]?.data || []);
  return (
    <div className="mt-2 h-[148px] [&>div:first-child]:hidden">
      <Liveline
        data={[]}
        value={0}
        series={series}
        theme="light"
        grid
        badge={false}
        pulse={false}
        window={windowSecs}
        paused
        scrub
        cursor="crosshair"
        lineWidth={2.25}
        padding={{ top: 28, right: 8, bottom: 22, left: 8 }}
        formatValue={(value) => money.format(value)}
        formatTime={(time) => formatLivelineDay(time)}
      />
    </div>
  );
}

function polar(cx: number, cy: number, radius: number, angle: number) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, radius: number, start: number, end: number) {
  const sweep = end - start;
  if (sweep >= 359.5) {
    return `M ${cx} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx} ${cy + radius} A ${radius} ${radius} 0 1 1 ${cx} ${cy - radius}`;
  }
  const from = polar(cx, cy, radius, start);
  const to = polar(cx, cy, radius, end);
  const large = sweep > 180 ? 1 : 0;
  return `M ${from.x} ${from.y} A ${radius} ${radius} 0 ${large} 1 ${to.x} ${to.y}`;
}

function SplitRing({
  items,
  hero,
  ariaLabel,
}: {
  items: ChartItem[];
  hero?: ChartItem;
  ariaLabel: string;
}) {
  const [active, setActive] = useState(hero ? '' : items[0]?.key || '');
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const selected = items.find((item) => item.key === active);
  const selectedShare = total && selected ? selected.value / total : 0;
  const size = 176;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 54;
  const present = items.filter((item) => item.value > 0);
  const gap = present.length > 1 ? 12 : 0;
  let cursor = -90;
  const slices = items.map((item) => {
    const share = total ? item.value / total : 0;
    const sweep = item.value > 0 ? Math.max(share * 360 - gap, present.length === 1 ? 360 : 14) : 0;
    const start = cursor + gap / 2;
    const end = start + sweep;
    cursor += share * 360;
    const mid = (start + end) / 2;
    const label = polar(cx, cy, 80, mid);
    return { ...item, start, end, sweep, mid, share, label };
  });
  const centerLabel = selected?.label || hero?.label || items[0]?.label || '';
  const centerValue = selected
    ? percentLabel(selectedShare)
    : hero
      ? money.format(hero.value)
      : percentLabel(0);

  return (
    <div className="mt-2" onMouseLeave={() => hero && setActive('')}>
      <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto h-[168px] w-[168px]" role="img" aria-label={ariaLabel}>
        <circle cx={cx} cy={cy} r={70} fill="none" stroke="var(--border)" strokeDasharray="2 5" strokeWidth="1" />
        <circle cx={cx} cy={cy} r={38} fill="none" stroke="var(--border)" strokeDasharray="2 5" strokeWidth="1" />
        {slices.filter((slice) => slice.sweep > 0).map((slice) => (
          <path
            key={slice.key}
            d={arcPath(cx, cy, radius, slice.start, slice.end)}
            fill="none"
            stroke={seriesColor(slice.key)}
            strokeWidth={active === slice.key ? 16 : 13}
            strokeLinecap="round"
            opacity={!active || active === slice.key ? 1 : 0.62}
            className="cursor-pointer"
            onMouseEnter={() => setActive(slice.key)}
            onClick={() => setActive(slice.key)}
          />
        ))}
        {slices.filter((slice) => slice.value > 0).map((slice) => (
          <text
            key={`${slice.key}-label`}
            x={slice.label.x}
            y={slice.label.y}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-muted-foreground text-[10px] tabular-nums"
          >
            {percentLabel(slice.share)}
          </text>
        ))}
        <text x={cx} y={cy - 11} textAnchor="middle" className="fill-muted-foreground text-[10px]">
          {centerLabel}
        </text>
        <text x={cx} y={cy + 10} textAnchor="middle" className="fill-foreground text-[15px] font-semibold tabular-nums">
          {centerValue}
        </text>
      </svg>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {items.map((item, index) => (
          <span key={item.key} className="inline-flex items-center gap-3">
            {index > 0 ? <span className="text-[8px] text-border" aria-hidden>◆</span> : null}
            <button
              type="button"
              aria-pressed={active === item.key}
              onClick={() => setActive(item.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-1 py-0.5',
                active === item.key ? 'text-foreground' : 'hover:text-foreground',
              )}
            >
              <span className="size-2 rounded-[2px]" style={{ background: seriesColor(item.key) }} />
              {item.label}
              <span className="tabular-nums text-foreground/80">{percentLabel(total ? item.value / total : 0)}</span>
            </button>
          </span>
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
  const charts = settlementCharts(summary);
  const days = settlementDailySeries(sales);
  if (!summary?.saleCount) return null;
  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-3">
      {charts.map((chart) => {
        const caption = [
          chart.hero ? `${chart.hero.label} ${money.format(chart.hero.value)}` : '',
          ...chart.items.map((item) => `${item.label} ${money.format(item.value)}`),
        ].filter(Boolean).join(', ');
        return (
          <div key={chart.id} aria-label={caption}>
            <MetricHeader hero={chart.hero} items={chart.items} hint={chart.hint} />
            {chart.kind === 'compare' ? (
              <MultiSeriesChart
                series={chart.items.map((item) => seriesFromDays(days, item.key as keyof typeof LINE_COLOR, item.label))}
              />
            ) : null}
            {chart.kind === 'share' ? (
              <SplitRing items={chart.items} hero={chart.hero} ariaLabel="Comisión y logística" />
            ) : null}
            {chart.kind === 'together' ? (
              <MultiSeriesChart
                series={chart.items.map((item) => seriesFromDays(days, item.key as keyof typeof LINE_COLOR, item.label))}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
