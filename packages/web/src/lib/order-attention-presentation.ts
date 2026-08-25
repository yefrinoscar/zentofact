export type AttentionDeadlineItem = {
  promisedShippingAt?: string | null;
};

export type AttentionDeadlineTab = {
  value: string;
  label: string;
  count: number;
};

const LIMA_TIME_ZONE = 'America/Lima';

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function limaDateKey(value: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: LIMA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function tomorrowKey(now: Date) {
  return limaDateKey(new Date(now.getTime() + 24 * 60 * 60_000));
}

export function attentionDeadlineKey(item: AttentionDeadlineItem, now = new Date()) {
  const deadline = parseDate(item.promisedShippingAt);
  if (!deadline) return 'no-date';
  const key = limaDateKey(deadline);
  const today = limaDateKey(now);
  if (key < today) return 'overdue';
  if (key === today) return 'today';
  if (key === tomorrowKey(now)) return 'tomorrow';
  return key;
}

function dateTabLabel(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 17));
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: LIMA_TIME_ZONE,
    day: 'numeric',
    month: 'short',
  }).format(date);
}

export function attentionDeadlineTabs<T extends AttentionDeadlineItem>(items: T[], now = new Date()): AttentionDeadlineTab[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = attentionDeadlineKey(item, now);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const tabs: AttentionDeadlineTab[] = [{ value: 'all', label: 'Todos', count: items.length }];
  if (counts.has('overdue')) tabs.push({ value: 'overdue', label: 'Vencidos', count: counts.get('overdue') || 0 });
  tabs.push({ value: 'today', label: 'Vencen hoy', count: counts.get('today') || 0 });
  tabs.push({ value: 'tomorrow', label: 'Vencen mañana', count: counts.get('tomorrow') || 0 });
  const dated = [...counts.keys()]
    .filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key))
    .sort();
  for (const value of dated) tabs.push({ value, label: dateTabLabel(value), count: counts.get(value) || 0 });
  if (counts.has('no-date')) tabs.push({ value: 'no-date', label: 'Sin plazo', count: counts.get('no-date') || 0 });
  return tabs;
}

export function filterAttentionDeadline<T extends AttentionDeadlineItem>(items: T[], scope: string, now = new Date()) {
  if (scope === 'all') return items;
  return items.filter((item) => attentionDeadlineKey(item, now) === scope);
}

export function formatAttentionIngress(value: string | null | undefined, now = new Date()) {
  const date = parseDate(value);
  if (!date) return { relative: 'Sin fecha', exact: 'Ingreso no informado' };
  const elapsedHours = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 3_600_000));
  const relative = elapsedHours < 1
    ? 'hace menos de 1 h'
    : elapsedHours < 24
      ? `hace ${elapsedHours} h`
      : `hace ${Math.floor(elapsedHours / 24)} día${Math.floor(elapsedHours / 24) === 1 ? '' : 's'}`;
  return {
    relative,
    exact: new Intl.DateTimeFormat('es-PE', {
      timeZone: LIMA_TIME_ZONE,
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date),
  };
}

export function formatAttentionDeadline(value: string | null | undefined, now = new Date()) {
  const date = parseDate(value);
  if (!date) return { label: 'Sin plazo', tone: 'muted' as const };
  const key = attentionDeadlineKey({ promisedShippingAt: value }, now);
  const time = new Intl.DateTimeFormat('es-PE', {
    timeZone: LIMA_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
  if (key === 'overdue') return { label: `Vencido · ${time}`, tone: 'danger' as const };
  if (key === 'today') return { label: `Hoy · ${time}`, tone: 'warning' as const };
  if (key === 'tomorrow') return { label: `Mañana · ${time}`, tone: 'info' as const };
  return {
    label: new Intl.DateTimeFormat('es-PE', {
      timeZone: LIMA_TIME_ZONE,
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date),
    tone: 'muted' as const,
  };
}
