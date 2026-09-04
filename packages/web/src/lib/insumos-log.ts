const WHEN = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatInsumoQuantity(value: number) {
  return Number(value).toLocaleString('es-PE', { maximumFractionDigits: 2 });
}

export function formatInsumoChange(delta: number, after: number) {
  const signed = `${delta > 0 ? '+' : ''}${formatInsumoQuantity(delta)}`;
  return `${signed} · queda ${formatInsumoQuantity(after)}`;
}

export function formatInsumoWhen(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return WHEN.format(date);
}

export function formatInsumoActor(name?: string | null) {
  const trimmed = String(name || '').trim();
  return trimmed || 'Sin nombre';
}

export function nextQuantity(current: number, change: { delta?: number; absoluteTarget?: number }) {
  if (change.absoluteTarget != null) return Number(change.absoluteTarget);
  return current + Number(change.delta);
}

export function capErrorMessage(name: string, cap: number) {
  return `${name} no puede pasar de ${cap}.`;
}

export const PURCHASE_LOOKBACK_DAYS = 7;
export const PURCHASE_HORIZONS = { days: 3, week: 7, month: 30 } as const;

export type InsumoPurchase = {
  lookbackDays: number;
  consumed: number;
  hasConsumption: boolean;
  packSize: number;
  purchaseUnit: string;
  days: number;
  week: number;
  month: number;
};

export function suggestInsumoPurchases({
  consumedRecent,
  quantityOnHand,
  lookbackDays = PURCHASE_LOOKBACK_DAYS,
  packSize = 1,
  unit = 'rollos',
}: {
  consumedRecent: number;
  quantityOnHand: number;
  lookbackDays?: number;
  packSize?: number;
  unit?: string;
}): InsumoPurchase {
  const consumed = Math.max(0, Number(consumedRecent) || 0);
  const onHand = Math.max(0, Number(quantityOnHand) || 0);
  const windowDays = Number(lookbackDays) > 0 ? Number(lookbackDays) : PURCHASE_LOOKBACK_DAYS;
  const size = Number(packSize) > 1 ? Number(packSize) : 1;
  const hasConsumption = consumed > 0;
  const dailyRate = hasConsumption ? consumed / windowDays : 0;
  const buyFor = (horizonDays: number) => {
    if (!hasConsumption) return 0;
    const rolls = Math.max(0, Math.ceil((dailyRate * horizonDays) - onHand));
    return size > 1 ? Math.ceil(rolls / size) : rolls;
  };
  return {
    lookbackDays: windowDays,
    consumed,
    hasConsumption,
    packSize: size,
    purchaseUnit: size > 1 ? 'cajas' : unit,
    days: buyFor(PURCHASE_HORIZONS.days),
    week: buyFor(PURCHASE_HORIZONS.week),
    month: buyFor(PURCHASE_HORIZONS.month),
  };
}

export function formatInsumoPurchaseValue(value?: number | null, hasConsumption = true) {
  if (!hasConsumption || value == null || !Number.isFinite(Number(value))) return '—';
  return formatInsumoQuantity(value);
}

export type InsumoPurchaseAmount = {
  value: string;
  label: string;
  needed: boolean;
};

export type InsumoPurchaseCopy = {
  empty: string | null;
  week: InsumoPurchaseAmount | null;
  month: InsumoPurchaseAmount | null;
};

function purchaseAmount(quantity: number, unit: string, label: string): InsumoPurchaseAmount {
  const needed = Number(quantity) > 0;
  return {
    value: needed ? `${formatInsumoQuantity(quantity)} ${unit}`.trim() : 'Nada',
    label,
    needed,
  };
}

export function formatInsumoPurchaseCopy(
  purchase?: InsumoPurchase | null,
  unit = 'rollos',
): InsumoPurchaseCopy {
  if (!purchase?.hasConsumption) {
    return { empty: 'Todavía no hay consumo.', week: null, month: null };
  }
  const purchaseUnit = purchase.purchaseUnit || unit;
  return {
    empty: null,
    week: purchaseAmount(purchase.week, purchaseUnit, 'para cubrir la semana'),
    month: purchaseAmount(purchase.month, purchaseUnit, 'para cubrir el mes'),
  };
}
