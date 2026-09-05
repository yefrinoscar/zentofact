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
  order_status?: string | null;
  fulfillment_status?: string | null;
  orderStatus?: string | null;
  fulfillmentStatus?: string | null;
};

export type StockOrderForPresentation = {
  status?: string | null;
  orderStatus?: string | null;
  fulfillmentStatus?: string | null;
};

export type StockPreviewForPresentation = {
  order?: StockOrderForPresentation | null;
  items?: Array<{ stockState: string; quantity?: number }>;
  stock?: { applied?: number | null; skipped?: number | null };
};

export type StockTerminalKind = 'cancelled' | 'returned';

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

function isReintegratedStockJob(job: StockJobForPresentation) {
  return hasStockState(job, 'reversed')
    && count(job.reserved_units) === 0
    && count(job.applied_units) === 0;
}

const JOB_PIPELINE_STATUSES = new Set(['done', 'pending', 'processing', 'failed', 'skipped']);

function text(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

function firstText(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const next = text(value);
    if (next) return next;
  }
  return '';
}

export function stockTerminalKind(
  input: StockJobForPresentation | StockOrderForPresentation | null | undefined,
): StockTerminalKind | null {
  if (!input) return null;
  const record = input as StockJobForPresentation & StockOrderForPresentation;
  const orderStatus = firstText(record.order_status, record.orderStatus);
  const fulfillment = firstText(record.fulfillment_status, record.fulfillmentStatus);
  const raw = JOB_PIPELINE_STATUSES.has(text(record.status)) ? '' : text(record.status);
  if (fulfillment === 'returned' || raw.includes('returned')) return 'returned';
  if (
    orderStatus === 'cancelled'
    || fulfillment === 'cancelled'
    || orderStatus === 'failed'
    || fulfillment === 'failed'
    || raw.includes('cancel')
    || raw.includes('failed')
  ) {
    return 'cancelled';
  }
  if ('items' in input && isReintegratedStockJob(input)) return 'cancelled';
  return null;
}

function terminalDetail(kind: StockTerminalKind, reservedUnits: number, appliedUnits: number) {
  const noun = kind === 'returned' ? 'Devuelto' : 'Cancelado';
  if (reservedUnits > 0) return `${noun}, pero sigue reservado.`;
  if (appliedUnits > 0) return `${noun}, pero sigue descontado.`;
  return `${noun}. No descuenta.`;
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
  const terminal = stockTerminalKind(job);
  if (terminal) return terminal;
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

export function stockJobFilterBucket(job: StockJobForPresentation, listenFromAt?: string | null) {
  const visible = visibleStockJobStatus(job, listenFromAt);
  if (visible === 'cancelled' || visible === 'returned') return 'cancelled';
  return job.status;
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
  const terminal = stockTerminalKind(job);
  if (terminal) return terminalDetail(terminal, reservedUnits, appliedUnits);
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
  if (skipped > 0) return `${skipped} línea${skipped === 1 ? '' : 's'} omitida${skipped === 1 ? '' : 's'}`;
  if (result.supersededByOrderId) return 'Reemplazado por el registro canónico del pedido';
  if (result.missing === true) return 'Esperando que el pedido termine de cargar';
  return job.status === 'done' ? 'Procesado sin un movimiento de stock pendiente' : '—';
}

export function stockOrderStatusLabel(order?: StockOrderForPresentation | null) {
  const kind = stockTerminalKind(order);
  if (kind === 'returned') return 'Devuelto';
  if (kind === 'cancelled') return 'Cancelado';
  const fulfillment = text(order?.fulfillmentStatus);
  if (fulfillment === 'pending') return 'Pendiente';
  if (fulfillment === 'preparing') return 'En preparación';
  if (fulfillment === 'ready_to_ship') return 'Listo para enviar';
  if (fulfillment === 'shipped') return 'Enviado';
  if (fulfillment === 'delivered') return 'Entregado';
  const raw = String(order?.status || '').trim();
  if (raw && !raw.includes(' · ')) return raw;
  return raw ? raw.split(' · ')[0] : '—';
}

export function stockPreviewFooter(preview: StockPreviewForPresentation | null | undefined) {
  const items = preview?.items || [];
  const reservedUnits = items
    .filter((item) => item.stockState === 'pending')
    .reduce((sum, item) => sum + count(item.quantity), 0);
  const appliedUnits = items
    .filter((item) => item.stockState === 'applied')
    .reduce((sum, item) => sum + count(item.quantity), 0);
  const terminal = stockTerminalKind(preview?.order);
  if (terminal) return terminalDetail(terminal, reservedUnits, appliedUnits);
  if (appliedUnits > 0 || count(preview?.stock?.applied) > 0) {
    const applied = appliedUnits || count(preview?.stock?.applied);
    return `${applied} línea${applied === 1 ? '' : 's'} descontada${applied === 1 ? '' : 's'}`;
  }
  if (reservedUnits > 0 || items.some((item) => item.stockState === 'pending')) {
    return 'Stock reservado; aún no sale del almacén.';
  }
  return 'Sin descuento de almacén.';
}

export function stockItemReason(
  item: { stockState: string; productId?: number | null; mainSku?: string | null },
  order?: StockOrderForPresentation | null,
) {
  const kind = stockTerminalKind(order);
  if (kind === 'cancelled') {
    if (item.stockState === 'pending') return 'Cancelado, pero sigue reservado.';
    if (item.stockState === 'applied') return 'Cancelado, pero sigue descontado.';
    return 'Volvió al almacén.';
  }
  if (kind === 'returned') {
    if (item.stockState === 'pending') return 'Devuelto, pero sigue reservado.';
    if (item.stockState === 'applied') return 'Devuelto, pero sigue descontado.';
    return 'Volvió al almacén.';
  }
  if (!item.productId && !item.mainSku) return 'No tiene producto maestro.';
  const labels: Record<string, string> = {
    pending: 'Reservado; descuenta al quedar listo para enviar.',
    applied: 'Descontado del almacén.',
    skipped_unmapped: 'No tiene producto maestro.',
    skipped_insufficient: 'El producto maestro no tiene stock disponible.',
    skipped_policy: 'Fuera del corte de descuentos.',
    reversed: 'Stock reintegrado.',
    none: 'Pendiente de procesar.',
  };
  return labels[item.stockState] || 'Estado de stock no reconocido.';
}
