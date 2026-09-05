export type RegisteredSaleFlash = {
  number: string;
  customer: string;
  total: number;
};

export type SaleValidationField = 'channel' | 'customer' | 'document' | 'products' | 'lines' | 'delivery';

/** Location state passed from Nueva venta → Mis ventas. */
export type MisVentasLocationState = {
  registered?: RegisteredSaleFlash | string | null;
  saveFailed?: boolean;
  saveError?: string | null;
};

export type OptimisticSale = {
  externalOrderNumber?: string | null;
  customer?: { name?: string | null } | null;
  total?: number | null;
  commission?: number | null;
  metadata?: { paymentMethod?: string | null } | null;
  orderedAt?: string | null;
  createdAt?: string | null;
};

type OptimisticPeriod = { orders: number; total: number; commission: number };

export type OptimisticHome = {
  today?: OptimisticPeriod;
  month?: OptimisticPeriod;
  daily?: Array<OptimisticPeriod & { date: string }>;
  orders?: OptimisticSale[];
  ordersTotal?: number;
  limit?: number;
  commissionPercent?: number;
};

function formatMoney(value: number) {
  try {
    return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(Number(value || 0));
  } catch {
    return `S/ ${Number(value || 0).toFixed(2)}`;
  }
}

/** POS-style toast: one line, the list is the real confirmation. */
export function saleSavedSnackbarMessage(sale: RegisteredSaleFlash) {
  const amount = formatMoney(sale.total);
  const customer = String(sale.customer || '').trim();
  if (customer) return `Venta guardada · ${customer} · ${amount}`;
  return `Venta guardada · ${amount}`;
}

export function saleSaveFailedSnackbarMessage(reason?: string | null) {
  return humanizeSaleError(reason);
}

export function registeredFromMisVentasState(
  state: MisVentasLocationState | null | undefined,
): RegisteredSaleFlash | null {
  const registered = state?.registered;
  if (!registered) return null;
  if (typeof registered === 'string') {
    return { number: registered, customer: '', total: 0 };
  }
  return registered;
}

/** Map validation copy to the form section that should show it inline. */
export function saleValidationField(message: string | null | undefined): SaleValidationField | null {
  const value = String(message || '').trim();
  if (!value) return null;
  if (value.includes('canal de venta manual')) return 'channel';
  if (value.includes('nombre del cliente') || value.includes('teléfono')) return 'customer';
  if (
    value.includes('DNI')
    || value.includes('RUC')
    || value.includes('razón social')
    || value.includes('carné')
    || value.includes('dirección fiscal')
  ) {
    return 'document';
  }
  if (value.includes('stock') || value.includes('producto')) return 'products';
  if (value.includes('cantidad y precio')) return 'lines';
  if (
    value.includes('fecha de entrega')
    || value.includes('reparto')
    || value.includes('dirección')
    || value.includes('no llega')
    || value.includes('Lima metropolitana')
    || value.includes('precio de envío')
  ) {
    return 'delivery';
  }
  return null;
}

/** Map raw backend/SQL noise to operator language. Validation messages pass through. */
export function humanizeSaleError(raw?: string | null) {
  const message = String(raw || '').trim();
  if (!message) return 'No se pudo guardar. Inténtalo otra vez.';

  const lower = message.toLowerCase();
  if (
    lower.includes('failed query')
    || lower.includes('column ')
    || lower.includes('relation ')
    || lower.includes('syntax error')
    || lower.includes('econnrefused')
    || lower.includes('network')
    || lower.includes('fetch')
  ) {
    return 'No se pudo guardar. Inténtalo otra vez.';
  }
  if (lower.includes('csrf')) return 'Sesión expirada. Vuelve a ingresar.';
  if (lower.includes('no autenticado') || lower.includes('unauthorized')) {
    return 'Sesión expirada. Vuelve a ingresar.';
  }
  if (message.length <= 120 && !lower.includes('stack') && !lower.includes('at async')) {
    return message;
  }
  return 'No se pudo guardar. Inténtalo otra vez.';
}

export function buildOptimisticSale(input: {
  orderNumber: string;
  customerName: string;
  total: number;
  commission?: number;
  paymentMethod?: string;
  orderedAt?: string;
}): OptimisticSale {
  const orderedAt = input.orderedAt || new Date().toISOString();
  return {
    externalOrderNumber: input.orderNumber,
    customer: { name: String(input.customerName || '').trim() },
    total: Number(input.total) || 0,
    commission: input.commission,
    metadata: { paymentMethod: input.paymentMethod || 'despues' },
    orderedAt,
    createdAt: orderedAt,
  };
}

function bumpPeriod(
  period: OptimisticPeriod | undefined,
  total: number,
  saleCommission: number,
) {
  const orders = (Number(period?.orders) || 0) + 1;
  const nextTotal = (Number(period?.total) || 0) + total;
  const commission = Math.round(((Number(period?.commission) || 0) + saleCommission) * 100) / 100;
  return { orders, total: nextTotal, commission };
}

function limaDateKey(value: string | undefined, fallback: Date) {
  const date = value ? new Date(value) : fallback;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' })
    .format(Number.isNaN(date.getTime()) ? fallback : date);
}

/**
 * Prepend a sale and bump hoy/mes, the daily bar for its date and the row count.
 * Pure — safe for React Query setQueryData. `prepend: false` keeps pages that
 * would not show the newest row first (other pages, other sort) numerically right
 * without inserting a row that does not belong there.
 */
export function applyOptimisticSale(
  home: OptimisticHome | null | undefined,
  sale: OptimisticSale,
  commissionPercent = Number(home?.commissionPercent) || 0,
  options: { prepend?: boolean; now?: Date } = {},
): OptimisticHome {
  const prepend = options.prepend !== false;
  const total = Number(sale.total) || 0;
  const commission = sale.commission ?? Math.round(total * commissionPercent) / 100;
  const existing = Array.isArray(home?.orders) ? home.orders : [];
  const number = String(sale.externalOrderNumber || '').trim();
  const withoutDup = number
    ? existing.filter((row) => String(row.externalOrderNumber || '').trim() !== number)
    : existing;
  const saleDate = limaDateKey(sale.orderedAt || sale.createdAt || undefined, options.now || new Date());
  const daily = Array.isArray(home?.daily)
    ? home.daily.map((day) => (day.date === saleDate ? { ...day, ...bumpPeriod(day, total, commission) } : day))
    : home?.daily;
  const limit = Number(home?.limit) || 0;
  const orders = prepend ? [sale, ...withoutDup] : existing;
  return {
    ...home,
    today: bumpPeriod(home?.today, total, commission),
    month: bumpPeriod(home?.month, total, commission),
    daily,
    orders: limit > 0 && orders.length > limit ? orders.slice(0, limit) : orders,
    ordersTotal: (Number(home?.ordersTotal) || withoutDup.length) + 1,
    commissionPercent,
  };
}
