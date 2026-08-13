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
  return orderItems.length > 0
    && orderItems.every((item) => orderItemStatus(item).includes('ready_to_ship'));
}
