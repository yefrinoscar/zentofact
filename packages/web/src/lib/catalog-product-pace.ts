export const CATALOG_SALES_PACE_DAYS = 7;

export type CatalogSalesPaceTone = 'muted' | 'ok' | 'warn' | 'danger';

export type CatalogSalesPace = {
  sold: number;
  unitsPerDay: number;
  hasSales: boolean;
  depleted: boolean;
  daysOfCover: number | null;
  rateLabel: string;
  coverLabel: string;
  tone: CatalogSalesPaceTone;
};

function asNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatPaceRate(value: number) {
  const digits = value >= 10 ? 0 : 1;
  return value.toLocaleString('es-PE', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function coverCopy({
  hasSales,
  stock,
  daysOfCover,
  lookbackDays,
}: {
  hasSales: boolean;
  stock: number;
  daysOfCover: number | null;
  lookbackDays: number;
}) {
  if (!hasSales) return `últimos ${lookbackDays} días`;
  if (stock <= 0) return 'agotado';
  if (daysOfCover == null) return `últimos ${lookbackDays} días`;
  if (daysOfCover < 1) return 'menos de 1 día';
  const rounded = Math.round(daysOfCover);
  return rounded === 1 ? 'queda 1 día' : `queda ${rounded} días`;
}

function paceTone({
  hasSales,
  stock,
  daysOfCover,
}: {
  hasSales: boolean;
  stock: number;
  daysOfCover: number | null;
}): CatalogSalesPaceTone {
  if (!hasSales) return 'muted';
  if (stock <= 0) return 'danger';
  if (daysOfCover != null && daysOfCover <= 3) return 'warn';
  return 'ok';
}

export function catalogSalesPace({
  available,
  unitsSold7d,
  lookbackDays = CATALOG_SALES_PACE_DAYS,
}: {
  available?: number | null;
  unitsSold7d?: number | null;
  lookbackDays?: number;
} = {}): CatalogSalesPace {
  const sold = Math.max(0, asNumber(unitsSold7d));
  const stock = asNumber(available);
  const days = asNumber(lookbackDays, CATALOG_SALES_PACE_DAYS);
  const windowDays = days > 0 ? days : CATALOG_SALES_PACE_DAYS;
  const unitsPerDay = sold / windowDays;
  const hasSales = sold > 0;
  const daysOfCover = hasSales && stock > 0 ? stock / unitsPerDay : null;
  return {
    sold,
    unitsPerDay,
    hasSales,
    depleted: hasSales && stock <= 0,
    daysOfCover,
    rateLabel: hasSales ? `${formatPaceRate(unitsPerDay)} u/día` : 'Sin venta',
    coverLabel: coverCopy({ hasSales, stock, daysOfCover, lookbackDays: windowDays }),
    tone: paceTone({ hasSales, stock, daysOfCover }),
  };
}

export function catalogStockHint({
  quantityReserved,
  quantityPendingReturn,
}: {
  quantityReserved?: number | null;
  quantityPendingReturn?: number | null;
} = {}) {
  const reserved = Math.max(0, asNumber(quantityReserved));
  const pending = Math.max(0, asNumber(quantityPendingReturn));
  const parts = [];
  if (reserved > 0) parts.push(`${reserved.toLocaleString('es-PE')} reservadas`);
  if (pending > 0) parts.push(`${pending.toLocaleString('es-PE')} por aprobar`);
  return parts.join(' · ') || null;
}
