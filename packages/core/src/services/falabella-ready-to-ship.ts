export interface FalabellaReadyToShipPackage {
  packageId: string;
  orderItemIds: string[];
}

function orderItemId(item: any): string {
  return String(item?.OrderItemId ?? item?.OrderItemID ?? item?.orderItemId ?? item?.id ?? item?.Id ?? '').trim();
}

function packageId(item: any): string {
  return String(item?.PackageId ?? item?.PackageID ?? item?.packageId ?? '').trim();
}

function orderItemStatus(item: any): string {
  return String(item?.Status ?? item?.status ?? '').trim().toLowerCase();
}

export function canPrintFalabellaShippingLabel(status: unknown): boolean {
  const statuses = String(status || '')
    .toLowerCase()
    .split('|')
    .map((value) => value.trim())
    .filter(Boolean);

  return statuses.length > 0
    && statuses.every((value) => value === 'pending' || value === 'ready_to_ship');
}

export function groupReadyToShipPackages(orderItems: any[]): FalabellaReadyToShipPackage[] {
  const groups = new Map<string, string[]>();
  for (const item of orderItems) {
    const currentPackageId = packageId(item);
    const currentOrderItemId = orderItemId(item);
    if (!currentPackageId || !currentOrderItemId) continue;
    const ids = groups.get(currentPackageId) || [];
    if (!ids.includes(currentOrderItemId)) ids.push(currentOrderItemId);
    groups.set(currentPackageId, ids);
  }
  return Array.from(groups, ([currentPackageId, orderItemIds]) => ({
    packageId: currentPackageId,
    orderItemIds,
  }));
}

export function areAllOrderItemsReadyToShip(orderItems: any[]): boolean {
  return Boolean(readyToShipReachedStatus(orderItems));
}

export function pendingReadyToShipOrderItems(orderItems: any[]): any[] {
  return orderItems.filter((item) => !/(^|\|)(ready_to_ship|shipped|delivered)(\||$)/.test(orderItemStatus(item)));
}

export function readyToShipReachedStatus(orderItems: any[]): '' | 'ready_to_ship' | 'shipped' | 'delivered' {
  if (!orderItems.length) return '';
  const statuses = orderItems.map(orderItemStatus);
  if (statuses.every((status) => /(^|\|)delivered(\||$)/.test(status))) return 'delivered';
  if (statuses.every((status) => /(^|\|)(shipped|delivered)(\||$)/.test(status))) return 'shipped';
  if (statuses.every((status) => /(^|\|)(ready_to_ship|shipped|delivered)(\||$)/.test(status))) return 'ready_to_ship';
  return '';
}
