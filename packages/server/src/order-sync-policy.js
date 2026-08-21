const LIMA_UTC_OFFSET_HOURS = 5;
const FIVE_CALENDAR_DAYS = 5;
const OVERLAP_MS = 10 * 60_000;
const SAFETY_LAG_MS = 60_000;
const MAX_BACKFILL_DAYS = 31;

function validDate(value, field) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${field} inválido.`);
  return date;
}

function limaCalendarDate(date) {
  return new Date(date.getTime() - LIMA_UTC_OFFSET_HOURS * 60 * 60_000)
    .toISOString()
    .slice(0, 10);
}

function limaDayStart(value, field) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    throw new Error(`${field} inválido; usa YYYY-MM-DD.`);
  }
  const date = new Date(`${value}T05:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`${field} inválido; usa YYYY-MM-DD.`);
  return date;
}

function fiveDayFloor(now) {
  const today = limaDayStart(limaCalendarDate(now), 'now');
  return new Date(today.getTime() - (FIVE_CALENDAR_DAYS - 1) * 86_400_000);
}

export function resolveIncrementalOrderWindow(input = {}) {
  const now = validDate(input.now || new Date(), 'now');
  const to = new Date(now.getTime() - SAFETY_LAG_MS);
  const floor = fiveDayFloor(now);
  const cursor = input.cursor ? validDate(input.cursor, 'cursor') : null;
  const overlappedCursor = cursor ? new Date(cursor.getTime() - OVERLAP_MS) : floor;
  const from = new Date(Math.max(floor.getTime(), overlappedCursor.getTime()));
  return { from: from.toISOString(), to: to.toISOString() };
}

export function resolveOrderBackfillWindow(input = {}) {
  const from = limaDayStart(input.from, 'from');
  const inclusiveTo = limaDayStart(input.to || input.from, 'to');
  if (inclusiveTo < from) throw new Error('to no puede ser anterior a from.');
  const days = Math.floor((inclusiveTo.getTime() - from.getTime()) / 86_400_000) + 1;
  if (days > MAX_BACKFILL_DAYS) throw new Error('El backfill admite máximo 31 días.');
  return {
    from: from.toISOString(),
    to: new Date(inclusiveTo.getTime() + 86_400_000 - 1).toISOString(),
  };
}
