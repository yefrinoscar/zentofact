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
  metadata?: { paymentMethod?: string | null } | null;
  orderedAt?: string | null;
  createdAt?: string | null;
};

export type OptimisticHome = {
  today?: { orders: number; total: number; commission: number };
  month?: { orders: number; total: number; commission: number };
  orders?: OptimisticSale[];
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
  if (value.includes('nombre del cliente')) return 'customer';
  if (
    value.includes('DNI')
    || value.includes('RUC')
    || value.includes('razón social')
    || value.includes('carné')
    || value.includes('dirección fiscal')
  ) {
    return 'document';
  }
  if (value.includes('producto')) return 'products';
  if (value.includes('cantidad') || value.includes('precio')) return 'lines';
  if (
    value.includes('fecha de entrega')
    || value.includes('reparto')
    || value.includes('dirección')
    || value.includes('no llega')
    || value.includes('Lima metropolitana')
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
  paymentMethod?: string;
  orderedAt?: string;
}): OptimisticSale {
  const orderedAt = input.orderedAt || new Date().toISOString();
  return {
    externalOrderNumber: input.orderNumber,
    customer: { name: String(input.customerName || '').trim() },
    total: Number(input.total) || 0,
    metadata: { paymentMethod: input.paymentMethod || 'despues' },
    orderedAt,
    createdAt: orderedAt,
  };
}

function bumpPeriod(
  period: { orders: number; total: number; commission: number } | undefined,
  total: number,
  commissionPercent: number,
) {
  const orders = (Number(period?.orders) || 0) + 1;
  const nextTotal = (Number(period?.total) || 0) + total;
  const commission = Math.round(nextTotal * (Number(commissionPercent) || 0)) / 100;
  return { orders, total: nextTotal, commission };
}

/** Prepend a sale and bump hoy/mes totals. Pure — safe for React Query setQueryData. */
export function applyOptimisticSale(
  home: OptimisticHome | null | undefined,
  sale: OptimisticSale,
  commissionPercent = Number(home?.commissionPercent) || 0,
): OptimisticHome {
  const total = Number(sale.total) || 0;
  const existing = Array.isArray(home?.orders) ? home.orders : [];
  const number = String(sale.externalOrderNumber || '').trim();
  const withoutDup = number
    ? existing.filter((row) => String(row.externalOrderNumber || '').trim() !== number)
    : existing;
  return {
    today: bumpPeriod(home?.today, total, commissionPercent),
    month: bumpPeriod(home?.month, total, commissionPercent),
    orders: [sale, ...withoutDup],
    commissionPercent,
  };
}
