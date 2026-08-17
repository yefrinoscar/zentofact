import { AlertTriangle, Ban, BarChart3, Package, PackagePlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from './ui/skeleton';

export type CatalogInventorySummary = {
  total?: number;
  active?: number;
  scopedTotal?: number;
  withoutSales?: number;
  outOfStock?: number;
  unitsAvailable?: number;
  unitsToReorder?: number;
  unitsSold30?: number;
  revenue30?: number;
  daysOfSupply?: number | null;
  inventoryValue?: number;
};

const integerFormat = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 });

const ICONS = {
  products: Package,
  withoutSales: Ban,
  outOfStock: AlertTriangle,
  unitsToReorder: PackagePlus,
  unitsSold30: BarChart3,
};

const COLOR = {
  products: { text: 'text-sky-700 dark:text-sky-400', soft: 'bg-sky-500/10' },
  withoutSales: { text: 'text-amber-700 dark:text-amber-400', soft: 'bg-amber-500/10' },
  outOfStock: { text: 'text-rose-700 dark:text-rose-400', soft: 'bg-rose-500/10' },
  unitsToReorder: { text: 'text-violet-700 dark:text-violet-400', soft: 'bg-violet-500/10' },
  unitsSold30: { text: 'text-emerald-700 dark:text-emerald-400', soft: 'bg-emerald-500/10' },
};

type KpiKey = keyof typeof COLOR;

function asNumber(...values: Array<number | null | undefined>) {
  for (const value of values) {
    if (value == null) continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

export function catalogKpiItems(summary?: CatalogInventorySummary | null, productCount?: number | null) {
  const products = asNumber(productCount, summary?.scopedTotal);
  const withoutSales = asNumber(summary?.withoutSales);
  const outOfStock = asNumber(summary?.outOfStock);
  const unitsToReorder = asNumber(summary?.unitsToReorder);
  const unitsSold30 = asNumber(summary?.unitsSold30);

  return [
    {
      key: 'products' as const,
      label: 'Productos',
      why: 'SKUs que operas.',
      display: products == null ? '—' : integerFormat.format(products),
      raw: products,
    },
    {
      key: 'withoutSales' as const,
      label: 'Sin venta',
      why: '30 días quietos. Revisa o archiva.',
      display: withoutSales == null ? '—' : integerFormat.format(withoutSales),
      raw: withoutSales,
    },
    {
      key: 'outOfStock' as const,
      label: 'Quiebre',
      why: 'Publicados en 0. Hay que reponer.',
      display: outOfStock == null ? '—' : integerFormat.format(outOfStock),
      raw: outOfStock,
    },
    {
      key: 'unitsToReorder' as const,
      label: 'A pedir',
      why: 'Falta para cubrir el mes.',
      display: unitsToReorder == null ? '—' : `${integerFormat.format(unitsToReorder)} u`,
      raw: unitsToReorder,
    },
    {
      key: 'unitsSold30' as const,
      label: 'Vendidas',
      why: 'Salieron en 30 días.',
      display: unitsSold30 == null ? '—' : `${integerFormat.format(unitsSold30)} u`,
      raw: unitsSold30,
    },
  ];
}

function KpiIcon({ itemKey }: { itemKey: KpiKey }) {
  const Icon = ICONS[itemKey];
  const color = COLOR[itemKey];
  return (
    <span className={cn('grid size-8 place-items-center rounded-lg', color.soft, color.text)}>
      <Icon className="size-4" />
    </span>
  );
}

export function CatalogInventoryKpis({
  summary,
  productCount,
  loading,
}: {
  summary?: CatalogInventorySummary | null;
  productCount?: number | null;
  loading?: boolean;
}) {
  const waiting = Boolean(loading && !summary);
  const items = waiting
    ? catalogKpiItems({ scopedTotal: 0, withoutSales: 0, outOfStock: 0, unitsToReorder: 0, unitsSold30: 0 })
    : catalogKpiItems(summary, productCount);
  const groups = [
    { title: 'Listado', rows: items.filter((item) => item.key === 'products' || item.key === 'unitsSold30') },
    { title: 'Cuidado', rows: items.filter((item) => item.key === 'withoutSales' || item.key === 'outOfStock') },
    { title: 'Pedir', rows: items.filter((item) => item.key === 'unitsToReorder') },
  ];

  return (
    <div className="grid gap-5 lg:grid-cols-3" aria-label="Indicadores de producto">
      {groups.map((group) => (
        <div key={group.title}>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{group.title}</p>
          <div className="mt-2 grid grid-cols-2 gap-4">
            {group.rows.map((item) => (
              <div key={item.key} className="min-w-0">
                <KpiIcon itemKey={item.key} />
                {waiting
                  ? <Skeleton className="mt-3 h-8 w-20" />
                  : (
                    <span className={cn('mt-3 block text-2xl font-semibold tabular-nums tracking-tight', COLOR[item.key].text)}>
                      {item.display}
                    </span>
                  )}
                <span className="mt-1 block text-sm font-medium">{item.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{item.why}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
