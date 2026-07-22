import { AlertCircle, Banknote, Building2, FileMinus2, FileText, ReceiptText } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import type { DocumentStats } from '../lib/documentStats';

export type DocumentOverviewKind = 'boletas' | 'facturas' | 'credit-notes';

type Company = {
  id: number;
  nombre?: string;
  razonSocial?: string;
};

const currency = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', minimumFractionDigits: 2 });
const integer = new Intl.NumberFormat('es-PE');

const CONFIG = {
  boletas: {
    amountKey: 'boletasAmount',
    countKey: 'boletas',
    notAcceptedKey: 'boletasNotAccepted',
    countLabel: 'Boletas emitidas',
    notAcceptedLabel: 'Boletas no aceptadas',
    amountLabel: 'Monto de ventas',
    companyLabel: 'Empresas con ventas',
    emptyLabel: 'Sin ventas aceptadas en el periodo',
    icon: ReceiptText,
  },
  facturas: {
    amountKey: 'facturasAmount',
    countKey: 'facturas',
    notAcceptedKey: 'facturasNotAccepted',
    countLabel: 'Facturas emitidas',
    notAcceptedLabel: 'Facturas no aceptadas',
    amountLabel: 'Monto facturado',
    companyLabel: 'Empresas con facturación',
    emptyLabel: 'Sin facturas aceptadas en el periodo',
    icon: FileText,
  },
  'credit-notes': {
    amountKey: 'creditNotesAmount',
    countKey: 'creditNotes',
    notAcceptedKey: 'creditNotesNotAccepted',
    countLabel: 'Notas emitidas',
    notAcceptedLabel: 'Notas no aceptadas',
    amountLabel: 'Monto anulado',
    companyLabel: 'Empresas con anulaciones',
    emptyLabel: 'Sin notas aceptadas en el periodo',
    icon: FileMinus2,
  },
} as const;

export default function DocumentOverview({
  kind,
  stats,
  companies,
  rows,
  selectedCompanyId,
  periodLabel,
  loading,
}: {
  kind: DocumentOverviewKind;
  stats: DocumentStats | null;
  companies: Company[];
  rows: Array<{ companyId: number; fechaEmision?: string | null; mtoImpVenta?: string | number | null; estadoSunat?: string | null; estado?: string | null }>;
  selectedCompanyId: number | null;
  periodLabel: string;
  loading: boolean;
}) {
  const config = CONFIG[kind];
  const selectedStats = selectedCompanyId
    ? stats?.byCompany.find((row) => row.companyId === selectedCompanyId)
    : stats?.global;
  const totalAmount = Number(selectedStats?.[config.amountKey] || 0);
  const totalCount = Number(selectedStats?.[config.countKey] || 0);
  const notAccepted = Number(selectedStats?.[config.notAcceptedKey] || 0);
  const relevantCompanies = (stats?.byCompany || []).filter((row) => Number(row[config.amountKey]) > 0);
  const chartData = buildAmountChart(rows, selectedCompanyId, companies);
  const Icon = config.icon;
  const chartTitle = selectedCompanyId ? 'Monto por estado y fecha' : 'Monto por estado y empresa';

  return (
    <section className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)]" aria-label="Resumen del periodo">
      <Card size="sm" className="min-h-52 gap-2 py-3">
        <CardHeader className="px-4">
          <CardTitle>{chartTitle}</CardTitle>
          <CardDescription>{selectedCompanyId ? 'Empresa seleccionada' : 'Todas las empresas'} · {periodLabel}</CardDescription>
        </CardHeader>
        <CardContent className="h-44 px-3 pb-0 font-sans">
          {loading && !stats ? (
            <div className="h-full animate-pulse rounded-xl bg-muted" />
          ) : chartData.length === 0 ? (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">{config.emptyLabel}</div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="min-h-0 flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart accessibilityLayer data={chartData} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} tick={{ fill: 'var(--muted-foreground)', fontSize: 11, fontFamily: 'Inter Variable, Inter, sans-serif' }} />
                    <YAxis tickFormatter={(value) => compactAmount(Number(value) || 0)} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 10, fontFamily: 'Inter Variable, Inter, sans-serif' }} />
                    <ChartTooltip cursor={{ fill: 'var(--muted)', opacity: 0.35 }} content={<AmountTooltip />} />
                    <Bar dataKey="accepted" name="Aceptado" stackId="status" fill="var(--primary)" radius={[0, 0, 3, 3]} />
                    <Bar dataKey="cancelled" name="Anulado" stackId="status" fill="var(--muted-foreground)" />
                    <Bar dataKey="notAccepted" name="No aceptado" stackId="status" fill="var(--destructive)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ChartLegend />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <MetricCard icon={Icon} label={config.countLabel} value={integer.format(totalCount)} detail={periodLabel} loading={loading && !stats} />
        <MetricCard icon={AlertCircle} label={config.notAcceptedLabel} value={integer.format(notAccepted)} detail={notAccepted ? 'Requieren revisión' : 'Sin observaciones'} loading={loading && !stats} tone={notAccepted ? 'warning' : 'default'} />
        <MetricCard icon={Banknote} label={config.amountLabel} value={currency.format(totalAmount)} detail="Solo documentos aceptados" loading={loading && !stats} />
        <MetricCard icon={Building2} label={config.companyLabel} value={integer.format(selectedCompanyId ? (totalAmount ? 1 : 0) : relevantCompanies.length)} detail={selectedCompanyId ? 'Empresa seleccionada' : `${companies.length} configuradas`} loading={loading && !stats} />
      </div>
    </section>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  loading,
  tone = 'default',
}: {
  icon: typeof ReceiptText;
  label: string;
  value: string;
  detail: string;
  loading: boolean;
  tone?: 'default' | 'warning';
}) {
  return (
    <Card size="sm" className="min-h-24 justify-between gap-2 py-3">
      <CardHeader className="grid grid-cols-[1fr_auto] items-start gap-3 px-4">
        <div>
          <CardDescription>{label}</CardDescription>
          {loading ? <div className="mt-2 h-7 w-28 animate-pulse rounded-md bg-muted" /> : <CardTitle className="mt-1 text-2xl tracking-tight">{value}</CardTitle>}
        </div>
        <span className={`grid size-8 place-items-center rounded-lg ${tone === 'warning' ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`}>
          <Icon className="size-4" />
        </span>
      </CardHeader>
      <CardContent className="px-4"><p className="text-xs text-muted-foreground">{detail}</p></CardContent>
    </Card>
  );
}

function buildAmountChart(
  rows: Array<{ companyId: number; fechaEmision?: string | null; mtoImpVenta?: string | number | null; estadoSunat?: string | null; estado?: string | null }>,
  selectedCompanyId: number | null,
  companies: Company[],
) {
  const companyNames = new Map(companies.map((company) => [company.id, company.nombre || company.razonSocial || `Empresa ${company.id}`]));
  const grouped = new Map<string, { key: string; label: string; fullLabel: string; accepted: number; notAccepted: number; cancelled: number }>();
  for (const row of rows) {
    const date = String(row.fechaEmision || '').slice(0, 10);
    if (!date) continue;
    const companyName = companyNames.get(row.companyId) || `Empresa ${row.companyId}`;
    const key = selectedCompanyId ? date : String(row.companyId);
    const fullLabel = selectedCompanyId ? date : companyName;
    const current = grouped.get(key) || {
      key,
      label: selectedCompanyId ? `${date.slice(8, 10)}/${date.slice(5, 7)}` : shortName(companyName),
      fullLabel,
      accepted: 0,
      notAccepted: 0,
      cancelled: 0,
    };
    const status = String(row.estadoSunat || row.estado || '').toUpperCase();
    const amount = Number(row.mtoImpVenta) || 0;
    if (status === 'ACEPTADO') current.accepted += amount;
    else if (status === 'ANULADO' || status === 'REEMPLAZADO') current.cancelled += amount;
    else current.notAccepted += amount;
    grouped.set(key, current);
  }
  const values = [...grouped.values()];
  return selectedCompanyId
    ? values.sort((a, b) => a.key.localeCompare(b.key)).slice(-12)
    : values.sort((a, b) => (b.accepted + b.notAccepted + b.cancelled) - (a.accepted + a.notAccepted + a.cancelled)).slice(0, 8);
}

function shortName(value: string) {
  const clean = value.trim();
  return clean.length > 10 ? `${clean.slice(0, 9)}…` : clean;
}

function compactAmount(value: number) {
  return new Intl.NumberFormat('es-PE', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function AmountTooltip({ active, payload }: { active?: boolean; payload?: any[] }) {
  if (!active || !payload?.length) return null;
  const source = payload[0]?.payload || {};
  const accepted = Number(source.accepted) || 0;
  const cancelled = Number(source.cancelled) || 0;
  const notAccepted = Number(source.notAccepted) || 0;
  const total = accepted + cancelled + notAccepted;

  return (
    <div className="min-w-56 rounded-xl bg-popover p-3 font-sans text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10">
      <p className="mb-2 truncate font-medium text-foreground">{source.fullLabel || source.label}</p>
      <div className="space-y-2">
        <TooltipRow color="bg-primary" label="Aceptado" value={currency.format(accepted)} valueClass="text-primary" />
        <TooltipRow color="bg-muted-foreground" label="Anulado" value={currency.format(cancelled)} />
        <TooltipRow color="bg-destructive" label="No aceptado" value={currency.format(notAccepted)} valueClass="text-destructive" />
      </div>
      <div className="mt-2 flex items-center justify-between gap-6 border-t border-border/70 pt-2">
        <span className="text-muted-foreground">Monto total</span>
        <strong className="font-semibold tabular-nums text-foreground">{currency.format(total)}</strong>
      </div>
    </div>
  );
}

function TooltipRow({ color, label, value, valueClass = 'text-foreground' }: { color: string; label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <span className="flex items-center gap-2 text-muted-foreground"><span className={`size-2 rounded-full ${color}`} />{label}</span>
      <strong className={`font-semibold tabular-nums ${valueClass}`}>{value}</strong>
    </div>
  );
}

function ChartLegend() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-2 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-primary" />Aceptado</span>
      <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-muted-foreground" />Anulado</span>
      <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-destructive" />No aceptado</span>
    </div>
  );
}
