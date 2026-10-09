/**
 * Columnas visibles de la bandeja multicanal. El seller va debajo del número de pedido;
 * entrega, dirección y método viven en el detalle.
 */
export const MANAGED_ORDER_TABLE_COLUMNS = [
  'order',
  'product',
  'customer',
  'status',
  'total',
  'actions',
] as const;

/** Etapas operativas que agrupan los estados de despacho para filtrar la bandeja. */
export const MANAGED_ORDER_STAGES = [
  { value: 'to_prepare', label: 'Por preparar', statuses: ['unmapped', 'pending', 'preparing'] },
  { value: 'ready', label: 'Listos', statuses: ['ready_to_ship'] },
  { value: 'shipped', label: 'Enviados', statuses: ['shipped'] },
  { value: 'delivered', label: 'Entregados', statuses: ['delivered'] },
  { value: 'issues', label: 'Incidencias', statuses: ['cancelled', 'returned', 'failed'] },
] as const;

export type ManagedOrderStage = typeof MANAGED_ORDER_STAGES[number]['value'];

export function managedOrderStageStatuses(stage: string): readonly string[] {
  return MANAGED_ORDER_STAGES.find((entry) => entry.value === stage)?.statuses || [];
}

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
  if (type === 'recojo') return 'Tienda';
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

const EMPTY_ORDER_ROWS: never[] = [];

export function managedOrderListRows<T>(orders: T[] | null | undefined): T[] {
  return Array.isArray(orders) ? orders : EMPTY_ORDER_ROWS;
}

export type ManagedOrderListFilterInput = {
  channelCode: string;
  stage: string;
  date: string;
  search: string;
};

export function managedOrdersDateAfterDayChange(input: {
  selectedDate: string;
  previousToday: string;
  currentToday: string;
}) {
  return input.selectedDate === input.previousToday
    ? input.currentToday
    : input.selectedDate;
}

function trimmedSearch(search: string) {
  return String(search || '').trim();
}

/** Una búsqueda localiza el pedido en cualquier día. La tira de fechas solo cubre el pulso del día. */
export function buildManagedOrderListFilters(input: ManagedOrderListFilterInput) {
  const statuses = managedOrderStageStatuses(input.stage);
  return {
    channelCode: input.channelCode === 'all' ? undefined : input.channelCode,
    fulfillmentStatuses: statuses.length ? statuses.join(',') : undefined,
    ...buildManagedOrderSummaryFilters(input),
    includeItems: true,
    limit: MANAGED_ORDER_LIST_LIMIT,
    offset: 0,
  };
}

/** El resumen usa la misma fecha y búsqueda que la lista, sin canal ni etapa. */
export function buildManagedOrderSummaryFilters(input: Pick<ManagedOrderListFilterInput, 'date' | 'search'>) {
  const search = trimmedSearch(input.search);
  return {
    ...(search ? {} : { from: input.date, to: input.date }),
    search: search || undefined,
  };
}

export type ManagedOrderSummaryGroup = {
  channelCode: string;
  channelName?: string | null;
  fulfillmentStatus: string;
  ordersCount: number;
  salesTotal: number;
};

export type ManagedOrderChannelTab = {
  code: string;
  label: string;
  ordersCount: number;
  salesTotal: number;
  /** Participación en el monto vendido del período, de 0 a 100. */
  share: number;
};

/** Pestañas de canal: Todos primero y luego cada canal del catálogo, aunque no tenga pedidos. */
export function managedOrderChannelTabs(
  groups: ManagedOrderSummaryGroup[],
  catalog: Array<{ code: string; name: string }>,
): ManagedOrderChannelTab[] {
  const totals = new Map<string, { ordersCount: number; salesTotal: number }>();
  for (const group of groups) {
    const current = totals.get(group.channelCode) || { ordersCount: 0, salesTotal: 0 };
    current.ordersCount += Number(group.ordersCount) || 0;
    current.salesTotal += Number(group.salesTotal) || 0;
    totals.set(group.channelCode, current);
  }
  const allSales = [...totals.values()].reduce((sum, entry) => sum + entry.salesTotal, 0);
  const allOrders = [...totals.values()].reduce((sum, entry) => sum + entry.ordersCount, 0);
  const share = (sales: number) => (allSales > 0 ? Math.round((sales / allSales) * 100) : 0);
  const known = new Set(catalog.map((channel) => channel.code));
  const extra = groups
    .filter((group) => !known.has(group.channelCode))
    .map((group) => ({ code: group.channelCode, name: group.channelName || group.channelCode }))
    .filter((channel, index, list) => list.findIndex((entry) => entry.code === channel.code) === index);
  return [
    { code: 'all', label: 'Todos', ordersCount: allOrders, salesTotal: allSales, share: allSales > 0 ? 100 : 0 },
    ...[...catalog, ...extra].map((channel) => {
      const entry = totals.get(channel.code) || { ordersCount: 0, salesTotal: 0 };
      return { code: channel.code, label: channel.name, ...entry, share: share(entry.salesTotal) };
    }),
  ];
}

/** Conteo de pedidos por etapa dentro del canal elegido. */
export function managedOrderStageCounts(groups: ManagedOrderSummaryGroup[], channelCode: string) {
  const counts: Record<string, number> = { all: 0 };
  for (const stage of MANAGED_ORDER_STAGES) counts[stage.value] = 0;
  for (const group of groups) {
    if (channelCode !== 'all' && group.channelCode !== channelCode) continue;
    const count = Number(group.ordersCount) || 0;
    counts.all += count;
    const stage = MANAGED_ORDER_STAGES.find((entry) => (entry.statuses as readonly string[]).includes(group.fulfillmentStatus));
    if (stage) counts[stage.value] += count;
  }
  return counts;
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

export type ManagedOrderSellerInput = {
  companyId?: number | null;
  channelCode?: string | null;
  createdByName?: string | null;
  createdByRole?: string | null;
};

function salespersonName(order: ManagedOrderSellerInput) {
  return String(order.createdByName || '').trim();
}

/** Venta de vendedor: su nombre. Pedido de marketplace: el seller. */
export function isSalespersonOrder(order: ManagedOrderSellerInput) {
  return order.channelCode === 'manual' || order.createdByRole === 'vendedor';
}

export function sellerCellShowsPerson(order: ManagedOrderSellerInput) {
  return isSalespersonOrder(order) && Boolean(salespersonName(order));
}

export function sellerCellLabel(
  order: ManagedOrderSellerInput,
  companyById: Map<number, string>,
) {
  const name = salespersonName(order);
  if (sellerCellShowsPerson(order)) return name;
  if (order.companyId == null) return '';
  return companyById.get(order.companyId) || `Empresa ${order.companyId}`;
}
