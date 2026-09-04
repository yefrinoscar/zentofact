export type StockJobForPresentation = {
  status: string;
  attempts?: number;
  last_error?: string | null;
  ordered_at?: string | null;
  result?: Record<string, unknown> | null;
  items?: Array<{ stockState: string }>;
  reserved_units?: string | number;
  applied_units?: string | number;
  unmatched_items?: number;
  insufficient_items?: number;
};

export function shouldShowStockJobAttempts(job: StockJobForPresentation) {
  return count(job.attempts) > 1 && ['pending', 'processing', 'failed'].includes(job.status);
}

function count(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasStockState(job: StockJobForPresentation, state: string) {
  return job.items?.some((item) => item.stockState === state) === true;
}

function limaDateTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

const DEFAULT_LISTEN_FROM_AT = '2026-09-03T17:00:00.000Z';

export function isAtOrAfterListenFrom(orderedAt?: string | null, listenFromAt?: string | null) {
  if (!orderedAt) return false;
  const time = Date.parse(orderedAt);
  const cutoff = Date.parse(listenFromAt || DEFAULT_LISTEN_FROM_AT);
  if (Number.isNaN(time) || Number.isNaN(cutoff)) return false;
  return time >= cutoff;
}

export function visibleStockJobStatus(job: StockJobForPresentation, listenFromAt?: string | null) {
  if (job.status !== 'done') return job.status;
  if (count(job.unmatched_items) > 0) return 'unmatched';
  if (count(job.insufficient_items) > 0) return 'insufficient';
  if (hasStockState(job, 'skipped_policy') && !isAtOrAfterListenFrom(job.ordered_at, listenFromAt)) {
    return 'outside_window';
  }
  if (count(job.reserved_units) > 0) return 'reserved';
  if (count(job.applied_units) > 0 || count(job.result?.applied) > 0) return 'done';
  return 'processed';
}

export function isListableStockJob(job: StockJobForPresentation, listenFromAt?: string | null) {
  return isAtOrAfterListenFrom(job.ordered_at, listenFromAt);
}

export function stockJobDetail(job: StockJobForPresentation, listenFromAt?: string | null) {
  const result = job.result || {};
  const unmatched = count(job.unmatched_items);
  const insufficient = count(job.insufficient_items);
  const reservedUnits = count(job.reserved_units);
  const appliedUnits = count(job.applied_units);
  const applied = count(result.applied);
  const skipped = count(result.skipped);
  if (job.last_error) return job.last_error;
  if (unmatched > 0) return `${unmatched} línea${unmatched === 1 ? '' : 's'} sin producto maestro`;
  if (insufficient > 0) return `${insufficient} línea${insufficient === 1 ? '' : 's'} sin stock disponible`;
  if (hasStockState(job, 'skipped_policy') && !isAtOrAfterListenFrom(job.ordered_at, listenFromAt)) {
    const orderedAt = limaDateTime(job.ordered_at);
    const cutoff = limaDateTime(listenFromAt);
    const dates = orderedAt && cutoff
      ? ` pedido del ${orderedAt}, anterior al inicio de descuentos (${cutoff})`
      : ' pedido anterior al inicio de descuentos';
    return `No se descontó:${dates}.`;
  }
  if (reservedUnits > 0) return `${reservedUnits} u reservada${reservedUnits === 1 ? '' : 's'}; descuenta al enviar`;
  if (appliedUnits > 0) return `${appliedUnits} u descontada${appliedUnits === 1 ? '' : 's'}`;
  if (applied > 0) return `${applied} línea${applied === 1 ? '' : 's'} descontada${applied === 1 ? '' : 's'}`;
  const reserved = count(result.reserved);
  if (reserved > 0) return `${reserved} línea${reserved === 1 ? '' : 's'} reservada${reserved === 1 ? '' : 's'}`;
  if (skipped > 0) return `${skipped} línea${skipped === 1 ? '' : 's'} omitida${skipped === 1 ? '' : 's'}`;
  if (result.supersededByOrderId) return 'Reemplazado por el registro canónico del pedido';
  if (result.missing === true) return 'Esperando que el pedido termine de cargar';
  return job.status === 'done' ? 'Procesado sin un movimiento de stock pendiente' : '—';
}
