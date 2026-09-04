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
  days: number;
  week: number;
  month: number;
};

export function suggestInsumoPurchases({
  consumedRecent,
  quantityOnHand,
  lookbackDays = PURCHASE_LOOKBACK_DAYS,
}: {
  consumedRecent: number;
  quantityOnHand: number;
  lookbackDays?: number;
}): InsumoPurchase {
  const consumed = Math.max(0, Number(consumedRecent) || 0);
  const onHand = Math.max(0, Number(quantityOnHand) || 0);
  const windowDays = Number(lookbackDays) > 0 ? Number(lookbackDays) : PURCHASE_LOOKBACK_DAYS;
  const hasConsumption = consumed > 0;
  const dailyRate = hasConsumption ? consumed / windowDays : 0;
  const buyFor = (horizonDays: number) => (
    hasConsumption ? Math.max(0, Math.ceil((dailyRate * horizonDays) - onHand)) : 0
  );
  return {
    lookbackDays: windowDays,
    consumed,
    hasConsumption,
    days: buyFor(PURCHASE_HORIZONS.days),
    week: buyFor(PURCHASE_HORIZONS.week),
    month: buyFor(PURCHASE_HORIZONS.month),
  };
}

export function formatInsumoPurchaseValue(value?: number | null, hasConsumption = true) {
  if (!hasConsumption || value == null || !Number.isFinite(Number(value))) return '—';
  return formatInsumoQuantity(value);
}
