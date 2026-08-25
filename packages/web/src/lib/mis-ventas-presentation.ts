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

export type SalespersonPeriod = {
  orders: number;
  total: number;
  commission: number;
};

export type SalespersonHome = {
  today?: SalespersonPeriod;
  month?: SalespersonPeriod;
  orders?: SalespersonSale[];
  commissionPercent?: number;
};

export type SalespersonSale = {
  externalOrderNumber?: string | null;
  customer?: { name?: string | null } | null;
  total?: number | null;
  metadata?: { paymentMethod?: string | null } | null;
  orderedAt?: string | null;
  createdAt?: string | null;
};

function periodOrZero(period?: SalespersonPeriod | null): SalespersonPeriod {
  return {
    orders: Number(period?.orders) || 0,
    total: Number(period?.total) || 0,
    commission: Number(period?.commission) || 0,
  };
}

export function salespersonKpis(home?: SalespersonHome | null) {
  const today = periodOrZero(home?.today);
  const month = periodOrZero(home?.month);
  return [
    { period: 'Hoy', ...today },
    { period: 'Mes', ...month },
  ];
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

export function saleListRow(order: SalespersonSale) {
  return {
    number: String(order.externalOrderNumber || '').trim() || '—',
    customer: String(order.customer?.name || '').trim() || 'Sin nombre',
    total: Number(order.total) || 0,
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
