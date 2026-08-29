/** Columnas visibles de la bandeja multicanal. Sin Teléfono a propósito. */
export const MANAGED_ORDER_TABLE_COLUMNS = [
  'order',
  'seller',
  'customer',
  'origin',
  'delivery',
  'address',
  'time',
  'status',
  'method',
  'total',
  'actions',
] as const;

const CARRIER_LABELS: Record<string, string> = {
  marvisuar: 'Marvisuar',
  shaloom: 'Shaloom',
  dinsides: 'Dinsides',
  nosotros: 'Nosotros',
};

export type ManagedOrderDeliveryInput = {
  channelCode?: string | null;
  shipping?: {
    type?: string | null;
    carrier?: string | null;
    trackingCode?: string | null;
  } | null;
  metadata?: {
    delivery?: string | null;
    shippingCarrier?: string | null;
  } | null;
};

function carrierLabel(value?: string | null) {
  return CARRIER_LABELS[String(value || '').trim()] || '';
}

export function deliveryLabel(order: ManagedOrderDeliveryInput) {
  const type = order.shipping?.type || order.metadata?.delivery || '';
  if (type === 'recojo') return 'Recojo';
  const carrier = carrierLabel(order.shipping?.carrier || order.metadata?.shippingCarrier);
  if (carrier) return carrier;
  if (type === 'envio') return 'Envío';
  if (order.shipping?.trackingCode) return 'Envío';
  if (order.channelCode !== 'manual') return 'Marketplace';
  return '—';
}

export function deliveryShowsAsTag(label: string) {
  return label !== '—';
}
