import type { OperatorNotification } from './notifications-presentation';

const REALTIME_NOTIFICATION_KINDS = new Set<OperatorNotification['kind']>([
  'product_sold_out',
  'marketplace_mutation',
]);

export function unreadRealtimeNotifications(items: OperatorNotification[]) {
  return items.filter((item) => item.unread && REALTIME_NOTIFICATION_KINDS.has(item.kind));
}

export function freshRealtimeNotifications(
  seen: Iterable<string>,
  incoming: OperatorNotification[],
) {
  const known = new Set(seen);
  return incoming.filter((item) => !known.has(item.id));
}

export function initialRealtimeNotifications(
  incoming: OperatorNotification[],
  sessionStartedAt: number,
) {
  return incoming.filter((item) => (
    item.kind === 'marketplace_mutation'
    && (Date.parse(item.createdAt || '') || 0) >= sessionStartedAt
  ));
}
