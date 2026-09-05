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
  nosotros: 'Express',
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

export const MANAGED_ORDER_LIST_LIMIT = 500;

export type ManagedOrderListFilterInput = {
  companyId: string;
  channelCode: string;
  fulfillmentStatus: string;
  date: string;
  search: string;
};

function trimmedSearch(search: string) {
  return String(search || '').trim();
}

/** Una búsqueda localiza el pedido en cualquier día. La tira de fechas solo cubre el pulso del día. */
export function buildManagedOrderListFilters(input: ManagedOrderListFilterInput) {
  const search = trimmedSearch(input.search);
  return {
    companyId: input.companyId === 'all' ? undefined : Number(input.companyId),
    channelCode: input.channelCode === 'all' ? undefined : input.channelCode,
    fulfillmentStatus: input.fulfillmentStatus === 'all' ? undefined : input.fulfillmentStatus,
    ...(search ? {} : { from: input.date, to: input.date }),
    search: search || undefined,
    limit: MANAGED_ORDER_LIST_LIMIT,
    offset: 0,
  };
}

export function managedOrderSearchIgnoresDate(search: string) {
  return Boolean(trimmedSearch(search));
}

export function managedOrdersTableLabel(dateLabel: string, search: string) {
  const query = trimmedSearch(search);
  if (query) return `Pedidos con ${query}`;
  return `Pedidos de ${dateLabel}`;
}

export function managedOrdersEmptyTitle(search: string) {
  return trimmedSearch(search)
    ? 'No hay pedidos con esa búsqueda'
    : 'No hay pedidos para estos filtros';
}

export function managedOrdersEmptyHint(search: string) {
  return trimmedSearch(search)
    ? 'La búsqueda ignora la fecha. Prueba otro dato.'
    : 'Prueba otra búsqueda o registra una venta manual.';
}

export function managedOrdersSearchHelper(search: string) {
  return trimmedSearch(search) ? 'Busca en todos los días.' : '';
}
