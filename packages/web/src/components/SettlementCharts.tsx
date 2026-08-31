import { CartesianGrid, Label, Line, LineChart, Pie, PieChart, XAxis } from 'recharts';
import {
  money,
  percentLabel,
  saleDateLabel,
  settlementCharts,
  settlementDailySeries,
  waffleOutOf100,
} from '../lib/pagos-presentation';
import { cn } from '@/lib/utils';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';

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

function seriesColor(key: string) {
  return LINE_COLOR[key as keyof typeof LINE_COLOR] || LINE_COLOR.take;
}

const compareChartConfig = {
  facturado: { label: 'Facturado', color: LINE_COLOR.facturado },
  neto: { label: 'Neto', color: LINE_COLOR.neto },
} satisfies ChartConfig;

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

function CompareLineChart({ days }: { days: Array<{ date: string; facturado: number; neto: number }> }) {
  const data = days.length === 1 ? [days[0], days[0]] : days;
  return (
    <ChartContainer
      config={compareChartConfig}
      className="mt-2 aspect-auto h-[148px] w-full"
      initialDimension={{ width: 640, height: 148 }}
    >
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="date" hide />
        <ChartTooltip
          cursor={{ stroke: 'var(--border)', strokeDasharray: '3 3' }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            return (
              <div className="grid min-w-36 gap-1.5 rounded-xl bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/5">
                <p className="font-medium">{saleDateLabel(String(label || ''))}</p>
                {payload.map((item) => (
                  <p key={String(item.dataKey)} className="flex items-center justify-between gap-4">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <span className="size-2 rounded-[2px]" style={{ background: String(item.color || '') }} />
                      {item.name}
                    </span>
                    <span className="font-medium tabular-nums">{money.format(Number(item.value || 0))}</span>
                  </p>
                ))}
              </div>
            );
          }}
        />
        <Line
          type="monotone"
          dataKey="facturado"
          name="Facturado"
          stroke="var(--color-facturado)"
          strokeWidth={2.25}
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Line
          type="monotone"
          dataKey="neto"
          name="Neto"
          stroke="var(--color-neto)"
          strokeWidth={2.25}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ChartContainer>
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

const payoutChartConfig = {
  amount: { label: 'Neto' },
  paid: { label: 'Pagado', color: LINE_COLOR.paid },
  pending: { label: 'Pendiente', color: LINE_COLOR.pending },
} satisfies ChartConfig;

function NetoPie({ paid, pending }: { paid: number; pending: number }) {
  const paidValue = Math.max(0, paid);
  const pendingValue = Math.max(0, pending);
  const total = paidValue + pendingValue;
  const paidShare = total ? paidValue / total : 0;
  const pendingShare = total ? pendingValue / total : 0;
  const data = [
    { slice: 'paid', amount: paidValue, fill: 'var(--color-paid)' },
    { slice: 'pending', amount: pendingValue, fill: 'var(--color-pending)' },
  ].filter((item) => item.amount > 0);
  return (
    <div
      className="mt-2 grid w-full place-items-center"
      role="img"
      aria-label={`Neto ${money.format(total)}: pagado ${percentLabel(paidShare)}, pendiente ${percentLabel(pendingShare)}`}
    >
      <ChartContainer
        config={payoutChartConfig}
        className="aspect-square size-[148px] min-h-[148px] min-w-[148px] max-h-[148px] max-w-[148px] shrink-0 overflow-hidden"
        initialDimension={{ width: 148, height: 148 }}
      >
        <PieChart>
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent hideLabel nameKey="slice" />}
          />
          <Pie
            data={data}
            dataKey="amount"
            nameKey="slice"
            innerRadius="62%"
            outerRadius="88%"
            paddingAngle={data.length > 1 ? 5 : 0}
            cornerRadius="50%"
            stroke="none"
            startAngle={90}
            endAngle={450}
          >
            <Label
              content={({ viewBox }) => {
                if (!viewBox || !('cx' in viewBox) || !('cy' in viewBox)) return null;
                return (
                  <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                    <tspan x={viewBox.cx} y={(viewBox.cy || 0) - 7} className="fill-foreground text-[12px] font-semibold tabular-nums">
                      {money.format(total)}
                    </tspan>
                    <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 10} className="fill-muted-foreground text-[10px]">
                      Neto
                    </tspan>
                  </text>
                );
              }}
            />
          </Pie>
        </PieChart>
      </ChartContainer>
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
    <div className="grid grid-cols-1 items-start gap-x-8 gap-y-8 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
      {charts.map((chart) => {
        const caption = [
          chart.hero ? `${chart.hero.label} ${money.format(chart.hero.value)}` : '',
          ...chart.items.map((item) => `${item.label} ${money.format(item.value)}`),
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
}
