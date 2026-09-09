import { memo } from 'react';
import {
  money,
  percentLabel,
  settlementCharts,
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
type ChartItem = { key: string; label: string; value: number; withoutIgv?: number; tone?: Tone };

function seriesColor(key: string) {
  return LINE_COLOR[key as keyof typeof LINE_COLOR] || LINE_COLOR.take;
}

function MetricDot({ itemKey }: { itemKey: string }) {
  return (
    <span
      className="size-2 shrink-0 rounded-[2px]"
      style={{ background: seriesColor(itemKey) }}
    />
  );
}

function MetricAmounts({
  value,
  withoutIgv,
  color,
  size,
}: {
  value: number;
  withoutIgv?: number;
  color?: string;
  size: 'hero' | 'inline';
}) {
  const main = withoutIgv ?? value;
  const other = withoutIgv != null ? value : null;
  return (
    <span className="block">
      <span
        className={cn(
          'block font-semibold tabular-nums tracking-[-0.01em] leading-tight',
          size === 'hero' ? 'text-[17px]' : 'text-[12px] font-medium',
        )}
        style={color ? { color } : undefined}
      >
        {money.format(main)}
      </span>
      {other != null ? (
        <span className="mt-0.5 block text-[11px] font-normal tabular-nums text-muted-foreground">
          {money.format(other)}
        </span>
      ) : null}
    </span>
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
  const extras = hero ? items : [];
  return (
    <>
      <div className={cn('flex items-start gap-4', hero && 'flex-col gap-0')}>
        {lead.map((item) => (
          <div key={item.key} className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <MetricDot itemKey={item.key} />
              {item.label}
            </p>
            <MetricAmounts
              value={item.value}
              withoutIgv={item.withoutIgv}
              color={seriesColor(item.key)}
              size="hero"
            />
          </div>
        ))}
      </div>
      {extras.length ? (
        <div className="mt-1.5 flex flex-wrap items-start gap-x-4 gap-y-1">
          {extras.map((item) => (
            <div key={item.key} className="flex items-start gap-1.5 text-[12px]">
              <span className="mt-[3px]">
                <MetricDot itemKey={item.key} />
              </span>
              <span className="pt-px text-muted-foreground">{item.label}</span>
              <MetricAmounts
                value={item.value}
                withoutIgv={item.withoutIgv}
                color={seriesColor(item.key)}
                size="inline"
              />
            </div>
          ))}
        </div>
      ) : null}
      {hint ? <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
    </>
  );
}

function linePath(
  days: Array<{ date: string; facturado: number; neto: number }>,
  key: 'facturado' | 'neto',
  width: number,
  height: number,
) {
  const pad = 8;
  const max = Math.max(1, ...days.flatMap((day) => [day.facturado, day.neto]));
  const span = Math.max(days.length - 1, 1);
  return days.map((day, index) => {
    const x = pad + ((width - pad * 2) * index) / span;
    const y = height - pad - ((Number(day[key]) || 0) / max) * (height - pad * 2);
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
}

function CompareLineChart({ days }: { days: Array<{ date: string; facturado: number; neto: number }> }) {
  const data = days.length === 1 ? [days[0], days[0]] : days;
  if (!data.length) {
    return <div className="mt-2 h-[148px] w-full rounded-md bg-muted/40" aria-hidden />;
  }
  return (
    <svg
      viewBox="0 0 640 148"
      className="mt-2 h-[148px] w-full"
      role="img"
      aria-label="Facturado y neto por día"
    >
      <path d={linePath(data, 'facturado', 640, 148)} fill="none" stroke={LINE_COLOR.facturado} strokeWidth="2.25" />
      <path d={linePath(data, 'neto', 640, 148)} fill="none" stroke={LINE_COLOR.neto} strokeWidth="2.25" />
    </svg>
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

function NetoPie({ paid, pending }: { paid: number; pending: number }) {
  const paidValue = Math.max(0, paid);
  const pendingValue = Math.max(0, pending);
  const total = paidValue + pendingValue;
  const paidShare = total ? paidValue / total : 0;
  const pendingShare = total ? pendingValue / total : 0;
  const paidDeg = paidShare * 360;
  return (
    <div
      className="mt-2 grid w-full place-items-center"
      role="img"
      aria-label={`Neto ${money.format(total)}: pagado ${percentLabel(paidShare)}, pendiente ${percentLabel(pendingShare)}`}
    >
      <div className="relative size-[148px]">
        <div
          className="size-full rounded-full"
          style={{
            background: total
              ? `conic-gradient(from -90deg, ${LINE_COLOR.paid} 0 ${paidDeg}deg, ${LINE_COLOR.pending} ${paidDeg}deg 360deg)`
              : 'var(--muted)',
          }}
        />
        <div className="absolute inset-[18%] grid place-items-center rounded-full bg-background">
          <p className="text-center leading-tight">
            <span className="block text-[12px] font-semibold tabular-nums">{money.format(total)}</span>
            <span className="block text-[10px] text-muted-foreground">Neto</span>
          </p>
        </div>
      </div>
    </div>
  );
}

export const SettlementKpiStrip = memo(function SettlementKpiStrip({ summary, days = [] }: {
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
  days?: Array<{ date: string; facturado: number; neto: number }>;
}) {
  const charts = settlementCharts(summary);
  if (!summary?.saleCount) return null;
  return (
    <div className="grid grid-cols-1 items-start gap-x-8 gap-y-8 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
      {charts.map((chart) => {
        const caption = [
          chart.hero ? `${chart.hero.label} ${money.format(chart.hero.value)}` : '',
          ...chart.items.map((item) => {
            const net = item.withoutIgv != null ? ` ${money.format(item.withoutIgv)}` : '';
            return `${item.label} ${money.format(item.value)}${net}`;
          }),
        ].filter(Boolean).join(', ');
        return (
          <div key={chart.id} aria-label={caption} className="min-w-0">
            <MetricHeader hero={chart.hero} items={chart.items} hint={chart.hint} />
            {chart.kind === 'compare' ? (
              <CompareLineChart days={days} />
            ) : null}
            {chart.kind === 'waffle' ? (
              <WaffleHundred
                sold={Number(summary.bruto || 0)}
                commission={Number(summary.commission || 0)}
                shipping={Number(summary.shipping || 0)}
              />
            ) : null}
            {chart.kind === 'pie' ? (
              <NetoPie
                paid={Number(summary.paidNeto || 0)}
                pending={Number(summary.pendingNeto || 0)}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
});
