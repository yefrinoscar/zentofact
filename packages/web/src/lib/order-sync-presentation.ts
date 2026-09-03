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

export function syncResultNote(results: ReadonlyArray<{ status?: string; failed?: number }>) {
  const hasFailure = results.some((result) => (
    result.status === 'failed'
    || result.status === 'error'
    || result.status === 'partial'
    || Number(result.failed || 0) > 0
  ));
  if (hasFailure) return 'Incompleto';
  const stillRunning = results.some((result) => result.status === 'already_running' || result.status === 'running');
  return stillRunning ? 'En curso' : 'Actualizado';
}
