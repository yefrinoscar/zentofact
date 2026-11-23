// Presentación de Ganancias de vendedores. La ganancia del vendedor es su
// comisión: el servidor la calcula igual que en Mis ventas.

export type EarningsSortBy = 'commission' | 'salesTotal' | 'orders' | 'commissionShare' | 'name';
export type EarningsSortDir = 'asc' | 'desc';
export type CommissionRule = 'catalog' | 'percent' | 'partial' | 'missing';

export type SalespersonEarningRow = {
  userId: string;
  name: string;
  email: string | null;
  active: boolean;
  commissionPercent: number;
  ordersCount: number;
  unitsSold: number;
  salesTotal: number;
  commission: number;
  paidCommission: number;
  commissionShare: number | null;
  averageTicket: number | null;
  percentOrders: number;
  incompleteOrders: number;
  linesWithoutCommission: number;
  otherCurrencyOrders: number;
  lastSaleAt: string | null;
};

export type SalespersonEarningTotals = {
  salespeople: number;
  withSales: number;
  ordersCount: number;
  unitsSold: number;
  salesTotal: number;
  commission: number;
  paidCommission: number;
  commissionShare: number | null;
  incompleteOrders: number;
  linesWithoutCommission: number;
  percentOrders: number;
  otherCurrencyOrders: number;
};

export type SalespersonEarningsResponse = {
  range: { from: string; to: string };
  currency: 'PEN';
  salespeople: SalespersonEarningRow[];
  totals: SalespersonEarningTotals;
  totalCount: number;
  limit: number;
  offset: number;
  sortBy: EarningsSortBy;
  sortDir: EarningsSortDir;
};

export type SalespersonEarningSaleItem = {
  name: string;
  sku: string | null;
  quantity: number;
  unitCommission: number | null;
};

export type SalespersonEarningSale = {
  orderId: number;
  orderNumber: string;
  soldAt: string | null;
  customerName: string | null;
  total: number;
  commission: number;
  commissionRule: CommissionRule;
  linesWithoutCommission: number;
  paymentStatus: string;
  fulfillmentStatus: string | null;
  units: number;
  items: SalespersonEarningSaleItem[];
};

export type SalespersonEarningSalesResponse = {
  salesperson: { userId: string; name: string; email: string | null; active: boolean; commissionPercent: number };
  range: { from: string; to: string };
  currency: 'PEN';
  sales: SalespersonEarningSale[];
  totalCount: number;
  limit: number;
  offset: number;
};

export const EARNINGS_PAGE_SIZE = 20;
export const EARNINGS_SALES_PAGE_SIZE = 20;
export const EARNINGS_QUERY_KEY = 'salesperson-earnings';

const moneyFormat = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });
const countFormat = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 2 });
const SALE_DATE = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatEarningMoney(value: number | null | undefined) {
  return moneyFormat.format(Number(value || 0));
}

export function formatEarningCount(value: number | null | undefined) {
  return countFormat.format(Number(value || 0));
}

/** Porcentaje con un decimal; sin ventas no hay porcentaje. */
export function formatCommissionShare(share: number | null | undefined) {
  if (share == null || !Number.isFinite(share)) return '—';
  return `${(Math.round(share * 1000) / 10).toLocaleString('es-PE', { maximumFractionDigits: 1 })}%`;
}

export function formatSaleDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : SALE_DATE.format(date);
}

export function ordersLabel(count: number) {
  return `${formatEarningCount(count)} ${count === 1 ? 'venta' : 'ventas'}`;
}

/** Aviso de comisión incompleta en la fila; null cuando todo tiene comisión. */
export function incompleteCommissionLabel(row: Pick<SalespersonEarningRow, 'incompleteOrders'>) {
  const count = Number(row.incompleteOrders) || 0;
  if (count <= 0) return null;
  return `${formatEarningCount(count)} ${count === 1 ? 'venta' : 'ventas'} sin comisión completa`;
}

export function commissionRuleLabel(rule: CommissionRule) {
  if (rule === 'catalog') return 'Por producto';
  if (rule === 'percent') return '% del vendedor';
  if (rule === 'partial') return 'Faltan productos';
  return 'Sin comisión';
}

export function commissionRuleIsIncomplete(rule: CommissionRule) {
  return rule === 'partial' || rule === 'missing';
}

export function commissionRuleHint(rule: CommissionRule, linesWithoutCommission = 0) {
  if (rule === 'catalog') return 'Comisión de cada producto vendido.';
  if (rule === 'percent') return 'Ningún producto tiene comisión; usa el % del vendedor.';
  if (rule === 'partial') {
    return `${formatEarningCount(linesWithoutCommission)} ${linesWithoutCommission === 1 ? 'producto suma' : 'productos suman'} S/ 0. Define su comisión.`;
  }
  return 'Ni los productos ni el vendedor tienen comisión.';
}

const PAYMENT_LABELS: Record<string, string> = {
  paid: 'Pagado',
  pending: 'Por cobrar',
  partially_refunded: 'Reembolso parcial',
  unknown: 'Sin dato',
};

export function earningPaymentLabel(status: string | null | undefined) {
  return PAYMENT_LABELS[String(status || 'unknown')] || 'Sin dato';
}

export function salespersonSubtitle(row: Pick<SalespersonEarningRow, 'active' | 'commissionPercent'>) {
  const parts: string[] = [];
  if (row.commissionPercent > 0) parts.push(`${formatEarningCount(row.commissionPercent)}% si falta comisión`);
  if (!row.active) parts.push('Inactivo');
  return parts.join(' · ');
}

export function saleItemsLabel(items: SalespersonEarningSaleItem[]) {
  if (!items.length) return 'Sin productos';
  return items.map((item) => `${item.name} ×${formatEarningCount(item.quantity)}`).join(', ');
}

export type EarningsKpi = {
  key: 'commission' | 'salesTotal' | 'share' | 'incomplete';
  label: string;
  value: string;
  hint: string;
  tone: 'default' | 'warning';
};

export function earningsKpis(totals?: SalespersonEarningTotals | null): EarningsKpi[] {
  if (!totals) return [];
  const incomplete = totals.incompleteOrders > 0;
  return [
    {
      key: 'commission',
      label: 'Comisiones',
      value: formatEarningMoney(totals.commission),
      hint: `${formatEarningMoney(totals.paidCommission)} de ventas pagadas.`,
      tone: 'default',
    },
    {
      key: 'salesTotal',
      label: 'Ventas',
      value: formatEarningMoney(totals.salesTotal),
      hint: `${ordersLabel(totals.ordersCount)} · vendieron ${formatEarningCount(totals.withSales)} de ${formatEarningCount(totals.salespeople)}.`,
      tone: 'default',
    },
    {
      key: 'share',
      label: '% de la venta',
      value: formatCommissionShare(totals.commissionShare),
      hint: 'Comisión sobre lo vendido.',
      tone: 'default',
    },
    {
      key: 'incomplete',
      label: 'Sin comisión completa',
      value: ordersLabel(totals.incompleteOrders),
      hint: incomplete ? 'Suman de menos. Revisa la comisión.' : 'Todas las ventas tienen comisión.',
      tone: incomplete ? 'warning' : 'default',
    },
  ];
}

export function nextEarningsSort(
  current: { sortBy: EarningsSortBy; sortDir: EarningsSortDir },
  column: EarningsSortBy,
): { sortBy: EarningsSortBy; sortDir: EarningsSortDir } {
  if (current.sortBy === column) {
    return { sortBy: column, sortDir: current.sortDir === 'desc' ? 'asc' : 'desc' };
  }
  return { sortBy: column, sortDir: column === 'name' ? 'asc' : 'desc' };
}
