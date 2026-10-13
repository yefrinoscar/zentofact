export function canCancelManualOrder(order: {
  channelCode: string;
  orderStatus: string;
  fulfillmentStatus: string;
}): boolean {
  return order.channelCode === 'manual'
    && !['cancelled', 'failed'].includes(order.orderStatus)
    && !['cancelled', 'returned', 'failed'].includes(order.fulfillmentStatus);
}
