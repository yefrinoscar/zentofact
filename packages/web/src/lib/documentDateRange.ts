export type DocumentDateRange = { from: string; to: string };

const PERU_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function todayInLima() {
  return PERU_DATE.format(new Date());
}

export function defaultDocumentDateRange(): DocumentDateRange {
  const to = todayInLima();
  return { from: `${to.slice(0, 7)}-01`, to };
}

export function documentDateRangeForLastDays(days: number): DocumentDateRange {
  const to = todayInLima();
  const fromDate = dateFromKey(to);
  fromDate.setDate(fromDate.getDate() - Math.max(0, days - 1));
  return { from: dateKey(fromDate), to };
}

export function parseDocumentDateRange(searchParams: URLSearchParams): DocumentDateRange {
  const fallback = defaultDocumentDateRange();
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (!isDateKey(from) || !isDateKey(to) || from > to || to > fallback.to) return fallback;
  return { from, to };
}

export function dateFromKey(value: string) {
  return new Date(`${value}T12:00:00`);
}

export function dateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

export function addDaysToDateKey(value: string, days: number) {
  const next = dateFromKey(value);
  next.setDate(next.getDate() + days);
  return dateKey(next);
}

export function documentDateRangeLabel(range: DocumentDateRange) {
  const from = dateFromKey(range.from);
  const to = dateFromKey(range.to);
  const sameYear = from.getFullYear() === to.getFullYear();
  const sameMonth = sameYear && from.getMonth() === to.getMonth();
  const day = new Intl.DateTimeFormat('es-PE', { day: 'numeric' });
  const monthYear = new Intl.DateTimeFormat('es-PE', { month: 'short', year: 'numeric' });
  const full = new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', year: 'numeric' });
  if (sameMonth) return `${day.format(from)} - ${full.format(to)}`;
  if (sameYear) {
    const dayMonth = new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short' });
    return `${dayMonth.format(from)} - ${full.format(to)}`;
  }
  return `${full.format(from)} - ${full.format(to)}`;
}

export function isSameDocumentDateRange(a: DocumentDateRange, b: DocumentDateRange) {
  return a.from === b.from && a.to === b.to;
}

function isDateKey(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(dateFromKey(value).getTime()));
}
