export const FULFILLMENT_LABELS: Readonly<Record<string, string>> = {
  unmapped: 'Sin mapear',
  pending: 'Pendiente',
  preparing: 'Preparando',
  ready_to_ship: 'Listo para enviar',
  shipped: 'Enviado',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
  returned: 'Devuelto',
  failed: 'Con error',
};

export const FULFILLMENT_TONES: Readonly<Record<string, string>> = {
  unmapped: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300',
  pending: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  preparing: 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300',
  ready_to_ship: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300',
  shipped: 'border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300',
  delivered: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  cancelled: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300',
  returned: 'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300',
  failed: 'border-red-300 bg-red-100 text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300',
};

export function fulfillmentLabel(status: string) {
  return FULFILLMENT_LABELS[status] || 'Sin mapear';
}

export function fulfillmentTone(status: string) {
  return FULFILLMENT_TONES[status] || FULFILLMENT_TONES.unmapped;
}

export function syncStatusLabel(status: string) {
  const labels: Readonly<Record<string, string>> = {
    idle: 'Sincronización pendiente',
    pending: 'Sincronización pendiente',
    running: 'Sincronizando',
    success: 'Sincronizado',
    failed: 'Falló la sincronización',
    error: 'Falló la sincronización',
    partial: 'Sincronización incompleta',
    disabled: 'Sincronización desactivada',
  };
  return labels[status] || status || 'Sin actividad';
}

export const DEFAULT_ORDER_SYNC_INTERVAL_MINUTES = 15;
export const DEFAULT_ORDER_SYNC_LOOKBACK_DAYS = 5;
export const ORDER_SYNC_INTERVAL_OPTIONS = [1, 5, 15, 30, 60, 120] as const;
export const ORDER_SYNC_LOOKBACK_OPTIONS = [1, 2, 3, 5, 7, 15, 31] as const;

export function clampOrderSyncIntervalMinutes(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_ORDER_SYNC_INTERVAL_MINUTES;
  return Math.min(1440, Math.max(1, Math.round(parsed)));
}

export function clampOrderSyncLookbackDays(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_ORDER_SYNC_LOOKBACK_DAYS;
  return Math.min(31, Math.max(1, Math.round(parsed)));
}

export function orderSyncIntervalLabel(minutes: number) {
  const value = clampOrderSyncIntervalMinutes(minutes);
  if (value < 60) return `${value} min`;
  const hours = value / 60;
  return Number.isInteger(hours) ? `${hours} h` : `${value} min`;
}

export function orderSyncLookbackLabel(days: number) {
  const value = clampOrderSyncLookbackDays(days);
  return value === 1 ? '1 día' : `${value} días`;
}

export function isFailedOrderSyncResult(result: { status?: string; failed?: number }) {
  const status = String(result.status || '');
  return status === 'failed'
    || status === 'error'
    || status === 'partial'
    || Number(result.failed || 0) > 0;
}

export function syncResultNote(results: ReadonlyArray<{ status?: string; failed?: number }>) {
  const hasFailure = results.some(isFailedOrderSyncResult);
  if (hasFailure) return 'Incompleto';
  const stillRunning = results.some((result) => result.status === 'already_running' || result.status === 'running');
  return stillRunning ? 'En curso' : 'Actualizado';
}
