export const OPERATOR_NOTIFICATION_KINDS = [
  'emission_failed',
  'insumo_low_stock',
  'bandeja_overdue',
  'product_sold_out',
] as const;

export type OperatorNotificationKind = (typeof OPERATOR_NOTIFICATION_KINDS)[number];

export const OPERATOR_NOTIFICATION_SEVERITIES = ['critical', 'warning'] as const;

export type OperatorNotificationSeverity = (typeof OPERATOR_NOTIFICATION_SEVERITIES)[number];

export type OperatorNotification = {
  id: string;
  kind: OperatorNotificationKind;
  severity: OperatorNotificationSeverity;
  title: string;
  body: string;
  href: string;
  moduleLabel: string;
  count: number;
  createdAt: string | null;
  unread: boolean;
};

export type OperatorNotificationsResponse = {
  items: OperatorNotification[];
  unreadCount: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

function optionalIso(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseKind(value: unknown): OperatorNotificationKind | null {
  const kind = String(value || '');
  return OPERATOR_NOTIFICATION_KINDS.find((entry) => entry === kind) || null;
}

function parseSeverity(value: unknown): OperatorNotificationSeverity | null {
  const severity = String(value || '');
  return OPERATOR_NOTIFICATION_SEVERITIES.find((entry) => entry === severity) || null;
}

export function parseOperatorNotification(value: unknown): OperatorNotification | null {
  const row = isRecord(value) ? value : null;
  if (!row) return null;
  const kind = parseKind(row.kind);
  const severity = parseSeverity(row.severity);
  const id = String(row.id || '').trim();
  const title = String(row.title || '').trim();
  const href = String(row.href || '').trim();
  if (!kind || !severity || !id || !title || !href.startsWith('/')) return null;
  const count = Number(row.count);
  return {
    id,
    kind,
    severity,
    title,
    body: String(row.body || '').trim(),
    href,
    moduleLabel: String(row.moduleLabel || '').trim() || 'Aviso',
    count: Number.isFinite(count) && count > 0 ? count : 1,
    createdAt: optionalIso(row.createdAt),
    unread: row.unread === true,
  };
}

export function parseOperatorNotificationsResponse(value: unknown): OperatorNotificationsResponse {
  const row = isRecord(value) ? value : null;
  const rawItems = row && Array.isArray(row.items) ? row.items : [];
  const items = rawItems.flatMap((entry) => {
    const item = parseOperatorNotification(entry);
    return item ? [item] : [];
  });
  return {
    items,
    unreadCount: items.filter((item) => item.unread).length,
  };
}

export function unreadBadgeLabel(count: number) {
  if (count < 1) return '';
  if (count > 9) return '9+';
  return String(count);
}

export function notificationElapsedLabel(value: string | null | undefined, now = new Date()) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} día${days === 1 ? '' : 's'}`;
}

export function notificationAriaLabel(count: number) {
  if (count < 1) return 'Avisos';
  if (count === 1) return 'Avisos, 1 sin leer';
  return `Avisos, ${count} sin leer`;
}
