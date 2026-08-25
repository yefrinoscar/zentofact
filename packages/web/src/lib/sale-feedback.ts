export type SaleFlashTone = 'success' | 'error';

export type SaleFlash = {
  tone: SaleFlashTone;
  title: string;
  detail: string;
  hint?: string;
};

export type RegisteredSaleFlash = {
  number: string;
  customer: string;
  total: number;
};

/** Location state passed from Nueva venta → Mis ventas. */
export type MisVentasLocationState = {
  registered?: RegisteredSaleFlash | string | null;
  flash?: SaleFlash | null;
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

export function saleRegisteredFlash(sale: RegisteredSaleFlash): SaleFlash {
  const number = String(sale.number || '').trim() || '—';
  const customer = String(sale.customer || '').trim() || 'Sin nombre';
  return {
    tone: 'success',
    title: 'Venta lista',
    detail: `${number} · ${customer} · ${formatMoney(sale.total)}`,
    hint: 'Ya aparece en tu lista de hoy.',
  };
}

export function saleFailedFlash(reason?: string): SaleFlash {
  return {
    tone: 'error',
    title: 'No se guardó la venta',
    detail: humanizeSaleError(reason),
    hint: 'Revisa los datos e inténtalo de nuevo.',
  };
}

export function flashFromMisVentasState(state: MisVentasLocationState | null | undefined): SaleFlash | null {
  if (!state) return null;
  if (state.flash?.title) return state.flash;
  const registered = state.registered;
  if (!registered) return null;
  if (typeof registered === 'string') {
    return saleRegisteredFlash({ number: registered, customer: '', total: 0 });
  }
  return saleRegisteredFlash(registered);
}

/** Map raw backend/SQL noise to operator language. Validation messages pass through. */
export function humanizeSaleError(raw?: string | null) {
  const message = String(raw || '').trim();
  if (!message) return 'Algo falló al guardar. Inténtalo de nuevo.';

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
    return 'No pudimos guardar ahora. Inténtalo de nuevo en un momento.';
  }
  if (lower.includes('csrf')) return 'La sesión expiró. Vuelve a ingresar e inténtalo.';
  if (lower.includes('no autenticado') || lower.includes('unauthorized')) {
    return 'La sesión expiró. Vuelve a ingresar.';
  }
  // Keep short validation copy from the form as-is.
  if (message.length <= 120 && !lower.includes('stack') && !lower.includes('at async')) {
    return message;
  }
  return 'No pudimos guardar ahora. Inténtalo de nuevo en un momento.';
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
