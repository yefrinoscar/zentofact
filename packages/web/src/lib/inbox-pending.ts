export function resolvePendingDeadlineTab(input: {
  selectedTab: string | null;
  todayCount: number;
  pendingCount: number;
}) {
  if (input.selectedTab) return input.selectedTab;
  if (input.todayCount > 0) return 'today';
  return 'all';
}

export function displayedPendingOrders<T>(input: {
  selectedTab: string | null;
  pendingOrders: T[];
  groups: Record<string, T[]>;
}) {
  const tab = resolvePendingDeadlineTab({
    selectedTab: input.selectedTab,
    todayCount: input.groups.today?.length || 0,
    pendingCount: input.pendingOrders.length,
  });
  return {
    tab,
    orders: tab === 'all' ? input.pendingOrders : (input.groups[tab] || []),
  };
}

export function inboxVisibleCountLabel(stage: 'pending' | 'ready' | 'shipped', count: number) {
  if (stage === 'pending') return `${count} pedido${count === 1 ? '' : 's'}`;
  return `${count} etiqueta${count === 1 ? '' : 's'}`;
}

export function pendingBoardEmptyCopy(input: {
  visibleCount: number;
  pendingCount: number;
  selectedTab: string;
}) {
  if (input.visibleCount > 0) return null;
  if (input.pendingCount > 0 && input.selectedTab !== 'all') {
    const when = input.selectedTab === 'today' ? 'vence hoy' : 'en esta fecha';
    return `Ningún pendiente ${when}. Hay ${input.pendingCount} en otras fechas.`;
  }
  return 'No hay pedidos con estos filtros.';
}
