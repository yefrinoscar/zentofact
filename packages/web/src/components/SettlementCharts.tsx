import { useMemo, useState } from 'react';
import { Liveline, type LivelineSeries } from 'liveline';
import {
  formatLivelineDay,
  livelinePointsFromDays,
  livelineWindowSecs,
  money,
  saleDateLabel,
  settlementCharts,
  settlementDailySeries,
  settlementTrendPoints,
  waffleOutOf100,
} from '../lib/pagos-presentation';
import { cn } from '@/lib/utils';

const LINE_COLOR = {
  facturado: '#7A7672',
  neto: '#3B8F72',
  take: '#1C1917',
  commission: 'var(--primary)',
  shipping: 'color-mix(in oklch, var(--primary) 52%, white)',
  arrives: '#C9C5C0',
  paid: 'var(--primary)',
  pending: 'color-mix(in oklch, var(--primary) 46%, white)',
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

function WaffleHundred({
  sold,
  commission,
  shipping,
}: {
  sold: number;
  commission: number;
  shipping: number;
}) {
  const waffle = waffleOutOf100({ sold, commission, shipping });
  const legend = [
    { key: 'commission', label: 'Comisión', count: waffle.counts.commission },
    { key: 'shipping', label: 'Logística', count: waffle.counts.shipping },
    { key: 'arrives', label: 'Te llega', count: waffle.counts.arrives },
  ];
  return (
    <div className="mt-2 flex w-max items-start gap-3">
      <div
        className="grid grid-cols-10 gap-[3px]"
        role="img"
        aria-label={`De cada 100: ${waffle.counts.commission} comisión, ${waffle.counts.shipping} logística, ${waffle.counts.arrives} te llega`}
      >
        {waffle.cells.map((key, index) => (
          <span
            key={index}
            className="size-[11px] rounded-[2px]"
            style={{ background: seriesColor(key) }}
          />
        ))}
      </div>
      <div className="flex min-w-0 flex-col gap-1 pt-0.5 text-[11px] text-muted-foreground">
        {legend.map((item) => (
          <p key={item.key} className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px]" style={{ background: seriesColor(item.key) }} />
            {item.label}
            <span className="tabular-nums text-foreground/80">{item.count}%</span>
          </p>
        ))}
      </div>
    </div>
  );
}

function stackedPath(points: Array<{ x: number; y: number }>, baseline: number) {
  if (!points.length) return '';
  const top = points.map((point) => `${point.x},${point.y}`).join(' L ');
  const last = points[points.length - 1];
  const first = points[0];
  return `M ${first.x},${baseline} L ${top} L ${last.x},${baseline} Z`;
}

function linePath(points: Array<{ x: number; y: number }>) {
  if (!points.length) return '';
  return `M ${points.map((point) => `${point.x},${point.y}`).join(' L ')}`;
}

function StackedPayout({ days }: { days: DayRow[] }) {
  const [active, setActive] = useState<number | null>(null);
  const trend = useMemo(() => settlementTrendPoints(days, ['paid', 'pending']), [days]);
  const width = 280;
  const height = 132;
  const pad = { top: 10, right: 8, bottom: 22, left: 8 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const plotted = trend.map((point, index) => {
    const paid = Math.max(0, Number(point.paid || 0));
    const pending = Math.max(0, Number(point.pending || 0));
    return { paid, pending, neto: paid + pending, index };
  });
  const max = Math.max(1, ...plotted.map((point) => point.neto));
  const coords = plotted.map((point, index) => {
    const x = pad.left + (plotted.length < 2 ? innerW / 2 : (index / (plotted.length - 1)) * innerW);
    const yPaid = pad.top + innerH - (point.paid / max) * innerH;
    const yTop = pad.top + innerH - (point.neto / max) * innerH;
    return { ...point, x, yPaid, yTop };
  });
  const paidArea = stackedPath(coords.map((point) => ({ x: point.x, y: point.yPaid })), pad.top + innerH);
  const pendingArea = coords.length
    ? `M ${coords.map((point) => `${point.x},${point.yPaid}`).join(' L ')} L ${[...coords].reverse().map((point) => `${point.x},${point.yTop}`).join(' L ')} Z`
    : '';
  const labels = days.length
    ? [days[0], days[Math.floor((days.length - 1) / 2)], days[days.length - 1]]
        .map((row) => saleDateLabel(String(row.date || '')))
        .filter((label, index, list) => label && list.indexOf(label) === index)
    : [];
  const hover = active == null ? null : coords[active];

  return (
    <div className="relative mt-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[148px] w-full"
        role="img"
        aria-label="Pagado y pendiente apilados"
        onMouseLeave={() => setActive(null)}
        onMouseMove={(event) => {
          if (coords.length < 2) return;
          const box = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - box.left) / box.width;
          const index = Math.round(ratio * (coords.length - 1));
          setActive(Math.min(coords.length - 1, Math.max(0, index)));
        }}
      >
        {[0.25, 0.5, 0.75].map((tick) => (
          <line
            key={tick}
            x1={pad.left}
            x2={width - pad.right}
            y1={pad.top + innerH * tick}
            y2={pad.top + innerH * tick}
            stroke="currentColor"
            strokeDasharray="3 4"
            className="text-border"
          />
        ))}
        <path d={pendingArea} fill={LINE_COLOR.pending} />
        <path d={paidArea} fill={LINE_COLOR.paid} fillOpacity="0.92" />
        <path d={linePath(coords.map((point) => ({ x: point.x, y: point.yTop })))} fill="none" stroke={LINE_COLOR.pending} strokeWidth="1.75" />
        <path d={linePath(coords.map((point) => ({ x: point.x, y: point.yPaid })))} fill="none" stroke={LINE_COLOR.paid} strokeWidth="1.75" />
        {hover ? (
          <line
            x1={hover.x}
            x2={hover.x}
            y1={pad.top}
            y2={pad.top + innerH}
            stroke="currentColor"
            className="text-foreground/30"
          />
        ) : null}
        {labels.map((label, index) => {
          const x = pad.left + (labels.length < 2 ? innerW / 2 : (index / (labels.length - 1)) * innerW);
          return (
            <text key={`${label}-${index}`} x={x} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">
              {label}
            </text>
          );
        })}
      </svg>
      {hover ? (
        <div className="pointer-events-none absolute left-1/2 top-2 z-10 min-w-[9rem] -translate-x-1/2 rounded-md bg-zinc-900 px-2.5 py-1.5 text-[11px] text-white shadow">
          <p className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-[2px]" style={{ background: LINE_COLOR.paid }} />
            Pagado {money.format(hover.paid)}
          </p>
          <p className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-[2px]" style={{ background: LINE_COLOR.pending }} />
            Pendiente {money.format(hover.pending)}
          </p>
          <p className="mt-0.5 border-t border-white/15 pt-0.5 text-white/80">Neto {money.format(hover.neto)}</p>
        </div>
      ) : null}
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
    <div className="grid grid-cols-1 items-start gap-x-5 gap-y-5 sm:grid-cols-[minmax(0,1fr)_max-content_minmax(0,1fr)]">
      {charts.map((chart) => {
        const caption = [
          chart.hero ? `${chart.hero.label} ${money.format(chart.hero.value)}` : '',
          ...chart.items.map((item) => `${item.label} ${money.format(item.value)}`),
        ].filter(Boolean).join(', ');
        return (
          <div key={chart.id} aria-label={caption} className={chart.kind === 'waffle' ? 'w-max' : 'min-w-0'}>
            <MetricHeader hero={chart.hero} items={chart.items} hint={chart.hint} />
            {chart.kind === 'compare' ? (
              <MultiSeriesChart
                series={chart.items.map((item) => seriesFromDays(days, item.key as keyof typeof LINE_COLOR, item.label))}
              />
            ) : null}
            {chart.kind === 'waffle' ? (
              <WaffleHundred
                sold={Number(summary.bruto || 0)}
                commission={Number(summary.commission || 0)}
                shipping={Number(summary.shipping || 0)}
              />
            ) : null}
            {chart.kind === 'stack' ? <StackedPayout days={days} /> : null}
          </div>
        );
      })}
    </div>
  );
}
