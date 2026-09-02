export type LogisticsStage = 'pending' | 'ready' | 'shipped';
export type LogisticsChannel = 'falabella' | 'ripley' | 'manual';

export const LOGISTICS_CHANNELS: Array<{ value: 'all' | LogisticsChannel; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'falabella', label: 'Falabella' },
  { value: 'ripley', label: 'Ripley' },
  { value: 'manual', label: 'Manual' },
];

export const LOGISTICS_STAGES: Array<{ value: LogisticsStage; label: string }> = [
  { value: 'pending', label: 'Pendientes' },
  { value: 'ready', label: 'Listos' },
  { value: 'shipped', label: 'Enviados' },
];

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

export function logisticsDeliveryLabel(order: {
  channelCode?: string | null;
  shipping?: { type?: string | null; carrier?: string | null; trackingCode?: string | null } | null;
  metadata?: { delivery?: string | null; shippingCarrier?: string | null } | null;
}) {
  const type = String(order.shipping?.type || order.metadata?.delivery || '').trim().toLowerCase();
  if (type === 'recojo') return 'Recojo';
  const carrier = CARRIER_LABELS[String(order.shipping?.carrier || order.metadata?.shippingCarrier || '').trim().toLowerCase()];
  if (carrier) return carrier;
  if (type === 'envio' || order.shipping?.trackingCode) return 'Envío';
  if (order.channelCode === 'falabella' || order.channelCode === 'ripley') return 'Marketplace';
  return '—';
}

export function canPrintLogisticsLabel(order: {
  channelCode?: string | null;
  fulfillmentStatus?: string | null;
  companyId?: number | null;
}) {
  const channel = String(order.channelCode || '');
  const status = String(order.fulfillmentStatus || '');
  if (status === 'cancelled' || status === 'failed' || status === 'returned') return false;
  if (channel === 'manual') return true;
  if (channel === 'falabella') return status === 'ready_to_ship' && order.companyId != null;
  if (channel === 'ripley') return order.companyId != null && (status === 'ready_to_ship' || status === 'preparing' || status === 'pending');
  return false;
}

export function canMarkFalabellaReady(order: {
  channelCode?: string | null;
  fulfillmentStatus?: string | null;
  companyId?: number | null;
  externalOrderId?: string | null;
}) {
  return order.channelCode === 'falabella'
    && order.companyId != null
    && Boolean(order.externalOrderId)
    && (order.fulfillmentStatus === 'pending' || order.fulfillmentStatus === 'preparing');
}

export function logisticsCountLabel(stage: LogisticsStage, count: number) {
  if (stage === 'pending') return `${count} pedido${count === 1 ? '' : 's'}`;
  return `${count} etiqueta${count === 1 ? '' : 's'}`;
}

export function logisticsEmptyCopy(stage: LogisticsStage) {
  if (stage === 'pending') return 'Nada que preparar con estos filtros.';
  if (stage === 'ready') return 'No hay pedidos listos para imprimir.';
  return 'No hay envíos recientes.';
}

export function logisticsSkippedNotice(skipped: Array<{ id: number; reason: string }>) {
  if (!skipped.length) return '';
  if (skipped.length === 1) return skipped[0].reason;
  return `${skipped.length} pedidos no se imprimieron.`;
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
