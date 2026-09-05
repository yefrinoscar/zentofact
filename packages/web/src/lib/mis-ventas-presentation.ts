const PAYMENT_METHOD_LABELS: Record<string, string> = {
  despues: 'Después',
  efectivo: 'Efectivo',
  yape_plin: 'Yape / Plin',
  transferencia: 'Transferencia',
};

const DATE_LABEL = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const DAY_LABEL = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
});

export const MIS_VENTAS_PAGE_SIZE = 10;

export type SalespersonPeriod = {
  orders: number;
  total: number;
  commission: number;
};

export type SalespersonDay = SalespersonPeriod & { date: string };

export type PaymentMixEntry = {
  method: string;
  orders: number;
  total: number;
};

export type SalespersonHome = {
  today?: SalespersonPeriod;
  month?: SalespersonPeriod;
  range?: { from: string; to: string };
  daily?: SalespersonDay[];
  paymentMix?: PaymentMixEntry[];
  orders?: SalespersonSale[];
  ordersTotal?: number;
  limit?: number;
  offset?: number;
  commissionPercent?: number;
};

export type SalespersonSaleItem = {
  name?: string | null;
  sku?: string | null;
  quantity?: number | null;
  imageUrl?: string | null;
  shopSku?: string | null;
};

export type SalespersonSale = {
  externalOrderNumber?: string | null;
  customer?: { name?: string | null } | null;
  total?: number | null;
  commission?: number | null;
  metadata?: { paymentMethod?: string | null } | null;
  orderedAt?: string | null;
  createdAt?: string | null;
  items?: SalespersonSaleItem[] | null;
};

export type SalesSortBy = 'orderedAt' | 'total' | 'commission';
export type SalesSortDir = 'asc' | 'desc';

export type MisVentasQuery = {
  limit: number;
  offset: number;
  sortBy: SalesSortBy;
  sortDir: SalesSortDir;
};

export const DEFAULT_MIS_VENTAS_QUERY: MisVentasQuery = {
  limit: MIS_VENTAS_PAGE_SIZE,
  offset: 0,
  sortBy: 'orderedAt',
  sortDir: 'desc',
};

export const MIS_VENTAS_QUERY_KEY = 'salesperson-home';

export function misVentasHomeKey(query: MisVentasQuery) {
  return [MIS_VENTAS_QUERY_KEY, query] as const;
}

/** A freshly registered sale is the newest row, so only the first page sorted by date desc shows it inline. */
export function showsNewestSaleFirst(query: Partial<MisVentasQuery> | null | undefined) {
  return Number(query?.offset || 0) === 0
    && (query?.sortBy || 'orderedAt') === 'orderedAt'
    && (query?.sortDir || 'desc') === 'desc';
}

function periodOrZero(period?: SalespersonPeriod | null): SalespersonPeriod {
  return {
    orders: Number(period?.orders) || 0,
    total: Number(period?.total) || 0,
    commission: Number(period?.commission) || 0,
  };
}

export function estimateCommission(total: number, percent: number) {
  const amount = Number(total) || 0;
  const rate = Number(percent) || 0;
  if (amount <= 0 || rate <= 0) return 0;
  return Math.round(amount * rate) / 100;
}

export function salespersonKpis(home?: SalespersonHome | null) {
  const today = periodOrZero(home?.today);
  const month = periodOrZero(home?.month);
  return [
    { period: 'Hoy', ...today },
    { period: 'Mes', ...month },
  ];
}

/** One-line reminder of how the commission is computed, in operator words. */
export function commissionHint(percent?: number | null) {
  const rate = Number(percent) || 0;
  if (rate <= 0) return 'Sin comisión configurada.';
  const label = Number.isInteger(rate) ? String(rate) : rate.toFixed(1).replace('.', ',');
  return `${label}% de lo vendido.`;
}

export function limaTodayKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(now);
}

export function dailySeries(home?: SalespersonHome | null): SalespersonDay[] {
  return (home?.daily || [])
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(String(day?.date || '')))
    .map((day) => ({ date: day.date, ...periodOrZero(day) }));
}

export type ProductivityStats = {
  days: number;
  activeDays: number;
  orders: number;
  total: number;
  commission: number;
  ordersPerActiveDay: number;
  averageTicket: number;
  bestDay: SalespersonDay | null;
};

/** Window totals plus the rhythm numbers a salesperson compares against: days sold, sales per day, ticket. */
export function productivityStats(daily: SalespersonDay[]): ProductivityStats {
  let orders = 0;
  let total = 0;
  let commission = 0;
  let activeDays = 0;
  let bestDay: SalespersonDay | null = null;
  for (const day of daily) {
    orders += day.orders;
    total += day.total;
    commission += day.commission;
    if (day.orders > 0) activeDays += 1;
    if (day.total > 0 && (!bestDay || day.total > bestDay.total)) bestDay = day;
  }
  return {
    days: daily.length,
    activeDays,
    orders,
    total: Math.round(total * 100) / 100,
    commission: Math.round(commission * 100) / 100,
    ordersPerActiveDay: activeDays ? Math.round((orders / activeDays) * 10) / 10 : 0,
    averageTicket: orders ? Math.round((total / orders) * 100) / 100 : 0,
    bestDay,
  };
}

export type PaymentMixSlice = {
  key: string;
  label: string;
  orders: number;
  total: number;
  share: number;
};

export function paymentMixSlices(mix?: PaymentMixEntry[] | null): PaymentMixSlice[] {
  const entries = (mix || [])
    .map((entry) => ({
      key: String(entry?.method || 'sin_dato').trim() || 'sin_dato',
      orders: Number(entry?.orders) || 0,
      total: Number(entry?.total) || 0,
    }))
    .filter((entry) => entry.total > 0 || entry.orders > 0)
    .sort((a, b) => b.total - a.total);
  const sum = entries.reduce((acc, entry) => acc + entry.total, 0);
  return entries.map((entry) => ({
    ...entry,
    label: paymentMethodLabel(entry.key),
    share: sum > 0 ? entry.total / sum : 0,
  }));
}

export function paymentMethodLabel(value?: string | null) {
  const key = String(value || '').trim();
  return PAYMENT_METHOD_LABELS[key] || 'Sin dato';
}

export function saleDateLabel(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return DATE_LABEL.format(date);
}

/** `2026-08-24` → `24 ago`. Day keys are calendar dates, so format them without a timezone shift. */
export function dayKeyLabel(dateKey?: string | null) {
  const key = String(dateKey || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '';
  return DAY_LABEL.format(new Date(`${key}T12:00:00.000Z`)).replace('.', '');
}

export function saleProductSummary(items?: SalespersonSaleItem[] | null) {
  const lines = (items || []).filter((item) => (
    String(item?.name || '').trim() || String(item?.sku || '').trim()
  ));
  const first = lines[0];
  if (!first) {
    return { name: '', sku: '', imageUrl: null as string | null, shopSku: null as string | null, extraCount: 0 };
  }
  return {
    name: String(first.name || '').trim() || String(first.sku || '').trim(),
    sku: String(first.sku || '').trim(),
    imageUrl: String(first.imageUrl || '').trim() || null,
    shopSku: String(first.shopSku || '').trim() || null,
    extraCount: Math.max(lines.length - 1, 0),
  };
}

export function saleProductTitle(product: string, extraCount = 0) {
  const name = String(product || '').trim();
  if (!name) return '';
  if (extraCount <= 0) return name;
  return `${name} y ${extraCount} más`;
}

export function saleListRow(order: SalespersonSale, commissionPercent = 0) {
  const total = Number(order.total) || 0;
  const product = saleProductSummary(order.items);
  return {
    number: String(order.externalOrderNumber || '').trim() || '—',
    customer: String(order.customer?.name || '').trim() || 'Sin nombre',
    product: product.name,
    productTitle: saleProductTitle(product.name, product.extraCount),
    sku: product.sku,
    imageUrl: product.imageUrl,
    shopSku: product.shopSku,
    extraCount: product.extraCount,
    total,
    commission: order.commission ?? estimateCommission(total, commissionPercent),
    payment: paymentMethodLabel(order.metadata?.paymentMethod),
    date: saleDateLabel(order.orderedAt || order.createdAt),
  };
}

export function formatSaleMoney(value: number) {
  try {
    return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(Number(value || 0));
  } catch {
    return `S/ ${Number(value || 0).toFixed(2)}`;
  }
}

export function formatCompactMoney(value: number) {
  try {
    return new Intl.NumberFormat('es-PE', {
      style: 'currency',
      currency: 'PEN',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(Number(value || 0));
  } catch {
    return formatSaleMoney(value);
  }
}

export function percentLabel(share: number) {
  return `${Math.round((Number(share) || 0) * 100)}%`;
}
