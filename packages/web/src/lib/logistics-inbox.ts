export type LogisticsStage = 'pending' | 'ready' | 'shipped';
export type LogisticsChannel = 'falabella' | 'ripley' | 'manual';
export type LogisticsUrgency = 'overdue' | 'today' | 'tomorrow' | 'later';

export type LogisticsOrderLike = {
  channelCode?: string | null;
  fulfillmentStatus?: string | null;
  companyId?: number | null;
  externalOrderId?: string | null;
  promisedShippingAt?: string | null;
  shipping?: { type?: string | null; carrier?: string | null; trackingCode?: string | null } | null;
  metadata?: { delivery?: string | null; shippingCarrier?: string | null } | null;
  labelPrint?: { printCount?: number | null; lastPrintedAt?: string | null } | null;
};

export const LOGISTICS_CHANNELS: Array<{ value: 'all' | LogisticsChannel; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'falabella', label: 'Falabella' },
  { value: 'ripley', label: 'Ripley' },
  { value: 'manual', label: 'Manual' },
];

export const LOGISTICS_STAGES: Array<{
  value: LogisticsStage;
  label: string;
  description: string;
  activeClass: string;
  badgeClass: string;
}> = [
  { value: 'pending', label: 'Pendientes', description: 'Por preparar', activeClass: 'bg-amber-50 text-amber-900 shadow-sm', badgeClass: 'bg-amber-100 text-amber-800' },
  { value: 'ready', label: 'Listos para enviar', description: 'Etiqueta disponible', activeClass: 'bg-sky-50 text-sky-900 shadow-sm', badgeClass: 'bg-sky-100 text-sky-800' },
  { value: 'shipped', label: 'Enviados', description: 'Últimos 7 días', activeClass: 'bg-emerald-50 text-emerald-900 shadow-sm', badgeClass: 'bg-emerald-100 text-emerald-800' },
];

export const LOGISTICS_URGENCIES: Array<{
  value: LogisticsUrgency;
  label: string;
  description: string;
  className: string;
  pillClass: string;
}> = [
  { value: 'overdue', label: 'Vencidos', description: 'Fuera de plazo', className: 'border-rose-100 bg-rose-50 text-rose-900', pillClass: 'bg-rose-100 text-rose-700' },
  { value: 'today', label: 'Vencen hoy', description: 'Prioridad inmediata', className: 'border-amber-100 bg-amber-50 text-amber-900', pillClass: 'bg-amber-100 text-amber-700' },
  { value: 'tomorrow', label: 'Vencen mañana', description: 'Preparar con anticipación', className: 'border-sky-100 bg-sky-50 text-sky-900', pillClass: 'bg-sky-100 text-sky-700' },
  { value: 'later', label: 'Próximos', description: 'Después de mañana o sin fecha', className: 'border-slate-200 bg-slate-100 text-slate-900', pillClass: 'bg-slate-100 text-slate-700' },
];

const LIMA = 'America/Lima';

const CHANNEL_LABELS: Record<string, string> = {
  falabella: 'Falabella',
  ripley: 'Ripley',
  manual: 'Manual',
};

const CARRIER_LABELS: Record<string, string> = {
  marvisuar: 'Marvisuar',
  shaloom: 'Shaloom',
  dinsides: 'Dinsides',
  nosotros: 'Express',
};

export function logisticsChannelLabel(code?: string | null) {
  return CHANNEL_LABELS[String(code || '').trim().toLowerCase()] || String(code || 'Canal');
}

export function logisticsChannelClass(code?: string | null) {
  const value = String(code || '').trim().toLowerCase();
  if (value === 'falabella') return 'border-lime-300 bg-lime-100 text-lime-950';
  if (value === 'ripley') return 'border-fuchsia-300 bg-fuchsia-100 text-fuchsia-950';
  if (value === 'manual') return 'border-teal-300 bg-teal-100 text-teal-950';
  return 'border-slate-200 bg-slate-100 text-slate-800';
}

export function logisticsDeliveryLabel(order: LogisticsOrderLike) {
  const type = String(order.shipping?.type || order.metadata?.delivery || '').trim().toLowerCase();
  if (type === 'recojo') return 'Recojo';
  const carrier = CARRIER_LABELS[String(order.shipping?.carrier || order.metadata?.shippingCarrier || '').trim().toLowerCase()];
  if (carrier) return carrier;
  if (type === 'envio' || order.shipping?.trackingCode) return 'Envío';
  if (order.channelCode === 'falabella' || order.channelCode === 'ripley') return 'Marketplace';
  return '—';
}

export function canPrintLogisticsLabel(order: LogisticsOrderLike) {
  const channel = String(order.channelCode || '');
  const status = String(order.fulfillmentStatus || '');
  if (status === 'cancelled' || status === 'failed' || status === 'returned') return false;
  if (status === 'shipped' || status === 'delivered') return false;
  if (channel === 'manual') return true;
  if (channel === 'falabella') return status === 'ready_to_ship' && order.companyId != null;
  if (channel === 'ripley') return order.companyId != null && (status === 'ready_to_ship' || status === 'preparing' || status === 'pending');
  return false;
}

export function canMarkFalabellaReady(order: LogisticsOrderLike) {
  return order.channelCode === 'falabella'
    && order.companyId != null
    && Boolean(order.externalOrderId)
    && (order.fulfillmentStatus === 'pending' || order.fulfillmentStatus === 'preparing');
}

export function labelWasPrinted(order: LogisticsOrderLike) {
  return Number(order.labelPrint?.printCount || 0) > 0;
}

export function labelPrintTooltip(order: LogisticsOrderLike) {
  if (!labelWasPrinted(order)) return 'Esta etiqueta todavía no ha sido impresa.';
  const count = Number(order.labelPrint?.printCount || 0);
  const when = order.labelPrint?.lastPrintedAt ? ` el ${formatLogisticsDateTime(order.labelPrint.lastPrintedAt)}` : '';
  return `Etiqueta impresa${when}. ${count === 1 ? 'Se imprimió 1 vez.' : `Se imprimió ${count} veces.`}`;
}

export function parseLogisticsDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function limaDateKey(date: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: LIMA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function formatLogisticsDateTime(value?: string | null) {
  const date = parseLogisticsDate(value);
  if (!date) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: LIMA,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatLogisticsTime(value?: string | null) {
  const date = parseLogisticsDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('es-PE', { timeZone: LIMA, hour: 'numeric', minute: '2-digit' }).format(date);
}

export function logisticsUrgency(order: LogisticsOrderLike, now: Date): LogisticsUrgency {
  const deadline = parseLogisticsDate(order.promisedShippingAt);
  if (!deadline) return 'later';
  if (deadline.getTime() < now.getTime()) return 'overdue';
  const deadlineDay = limaDateKey(deadline);
  if (deadlineDay === limaDateKey(now)) return 'today';
  if (deadlineDay === limaDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000))) return 'tomorrow';
  return 'later';
}

export function logisticsElapsedLabel(value: string | null | undefined, now: Date) {
  const date = parseLogisticsDate(value);
  if (!date) return '';
  const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 60) return `hace ${Math.max(1, minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} día${days === 1 ? '' : 's'}`;
}

export function logisticsDeadlineLabel(order: LogisticsOrderLike, now: Date) {
  const deadline = parseLogisticsDate(order.promisedShippingAt);
  if (!deadline) return 'Sin plazo informado';
  const urgency = logisticsUrgency(order, now);
  if (urgency === 'overdue') {
    const minutes = Math.max(1, Math.floor((now.getTime() - deadline.getTime()) / 60_000));
    if (minutes < 60) return `Venció hace ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Venció hace ${hours} h`;
    const days = Math.floor(hours / 24);
    return `Venció hace ${days} día${days === 1 ? '' : 's'}`;
  }
  if (urgency === 'today') return `Hoy · ${formatLogisticsTime(order.promisedShippingAt)}`;
  if (urgency === 'tomorrow') return `Mañana · ${formatLogisticsTime(order.promisedShippingAt)}`;
  return formatLogisticsDateTime(order.promisedShippingAt);
}

export function logisticsUrgencyMeta(urgency: LogisticsUrgency) {
  return LOGISTICS_URGENCIES.find((item) => item.value === urgency) || LOGISTICS_URGENCIES[3];
}

export type LogisticsNextStep =
  | { kind: 'print'; label: 'Imprimir' | 'Reimprimir' }
  | { kind: 'ready'; label: 'Marcar listo' }
  | { kind: 'wait'; label: string }
  | { kind: 'view'; label: 'Ver detalle' };

export function logisticsNextStep(order: LogisticsOrderLike): LogisticsNextStep {
  const status = String(order.fulfillmentStatus || '');
  if (status === 'shipped' || status === 'delivered') return { kind: 'view', label: 'Ver detalle' };
  if (canPrintLogisticsLabel(order)) return { kind: 'print', label: labelWasPrinted(order) ? 'Reimprimir' : 'Imprimir' };
  if (canMarkFalabellaReady(order)) return { kind: 'ready', label: 'Marcar listo' };
  if (order.channelCode === 'falabella') return { kind: 'wait', label: 'Sin seller' };
  if (order.channelCode === 'ripley') return { kind: 'wait', label: 'Sin seller' };
  return { kind: 'view', label: 'Ver detalle' };
}

export type LogisticsFlowStep = { label: string; state: 'done' | 'current' | 'todo' };

export function logisticsFlowSteps(order: LogisticsOrderLike): LogisticsFlowStep[] {
  const status = String(order.fulfillmentStatus || '');
  const shipped = status === 'shipped' || status === 'delivered';
  if (order.channelCode === 'falabella') {
    const ready = status === 'ready_to_ship' || shipped;
    return [
      { label: 'Empacar', state: ready ? 'done' : 'current' },
      { label: 'Marcar listo', state: ready ? 'done' : 'todo' },
      { label: 'Etiqueta', state: shipped ? 'done' : ready ? 'current' : 'todo' },
    ];
  }
  const printed = labelWasPrinted(order);
  return [
    { label: 'Empacar', state: printed || shipped ? 'done' : 'current' },
    { label: 'Etiqueta', state: shipped ? 'done' : printed ? 'done' : 'current' },
    { label: 'Despachar', state: shipped ? 'done' : printed ? 'current' : 'todo' },
  ];
}

export function logisticsFlowCopy(order: LogisticsOrderLike) {
  const status = String(order.fulfillmentStatus || '');
  if (status === 'shipped' || status === 'delivered') return 'El pedido ya salió del almacén. No hace falta volver a imprimir.';
  if (order.channelCode === 'falabella') {
    if (canPrintLogisticsLabel(order)) return 'Falabella confirmó el pedido como listo. Imprime la etiqueta y la guía de armado.';
    if (canMarkFalabellaReady(order)) return 'Empaca todos los productos y confirma que está listo para habilitar la etiqueta de Falabella.';
    return 'Este pedido no tiene seller asociado; revísalo en Todos los pedidos.';
  }
  if (order.channelCode === 'ripley') {
    return 'Ripley genera la etiqueta desde Seller Center. Si aún no existe, la impresión avisará.';
  }
  if (labelWasPrinted(order)) return 'La etiqueta ya se imprimió. Pega la etiqueta y entrega el bulto al repartidor o al cliente.';
  return 'Empaca los productos e imprime la etiqueta ZentoFact con la guía de armado.';
}

export function logisticsCountLabel(stage: LogisticsStage, count: number) {
  if (stage === 'pending') return `${count} pedido${count === 1 ? '' : 's'}`;
  return `${count} etiqueta${count === 1 ? '' : 's'}`;
}

export function logisticsEmptyCopy(stage: LogisticsStage, urgency?: LogisticsUrgency | null) {
  if (urgency && stage !== 'shipped') {
    const meta = logisticsUrgencyMeta(urgency);
    return `Ningún pedido en “${meta.label}”. Quita el filtro de prioridad para ver el resto.`;
  }
  if (stage === 'pending') return 'Nada que preparar con estos filtros.';
  if (stage === 'ready') return 'No hay pedidos listos para imprimir.';
  return 'No hay envíos recientes.';
}

export function logisticsSkippedNotice(skipped: Array<{ id: number; reason: string }>) {
  if (!skipped.length) return '';
  if (skipped.length === 1) return skipped[0].reason;
  return `${skipped.length} pedidos no se imprimieron.`;
}

export function logisticsPrintSuccessCopy(result: { labelCount?: number; packingPageCount?: number }) {
  const labels = Number(result.labelCount || 0);
  const packing = Number(result.packingPageCount || 0);
  const labelCopy = `${labels} etiqueta${labels === 1 ? '' : 's'}`;
  if (!packing) return `Listo. ${labelCopy}.`;
  return `Listo. ${labelCopy} y ${packing} hoja${packing === 1 ? '' : 's'} de armado.`;
}

export function logisticsBulkReadySummary(total: number, failed: number) {
  if (!failed) return `${total} pedido${total === 1 ? '' : 's'} marcado${total === 1 ? '' : 's'} listo${total === 1 ? '' : 's'} para enviar.`;
  const ok = total - failed;
  return `${ok} marcado${ok === 1 ? '' : 's'}; ${failed} no pudo${failed === 1 ? '' : 'ieron'} actualizarse.`;
}

export function productImageSrc(url?: string | null, shopSku?: string | null) {
  const sku = String(shopSku || '').trim();
  const fallback = sku && /^[A-Za-z0-9_-]+$/.test(sku) ? `https://media.falabella.com/falabellaPE/${sku}_01` : '';
  const value = String(url || '').trim() || fallback;
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:' && /(^|\.)falabella\.com$/i.test(parsed.hostname)) {
      return `/catalog/image?url=${encodeURIComponent(value)}`;
    }
  } catch {
    return value;
  }
  return value;
}

export function openPdfFromBase64(base64: string, filename: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const preview = window.open(url, '_blank', 'noopener');
  if (!preview) {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  }
  return url;
}
