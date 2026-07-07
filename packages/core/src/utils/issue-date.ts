const DOCUMENT_LIMIT_DAYS: Record<'01' | '03', number> = {
  '01': 3,
  '03': 5,
};

function todayInLima(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function normalizeDateOnly(value: string | null | undefined): string {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function dayNumber(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

export function resolveIssueDate(
  originalDate: string | null | undefined,
  tipoDocumento: '01' | '03',
  today: string = todayInLima(),
) {
  const original = normalizeDateOnly(originalDate);
  const current = normalizeDateOnly(today) || todayInLima();
  const limitDays = DOCUMENT_LIMIT_DAYS[tipoDocumento];
  if (!original) {
    return { fechaEmision: current, fechaEmisionOriginal: '', changed: false, reason: 'fecha-original-invalida' };
  }

  const ageDays = dayNumber(current) - dayNumber(original);
  if (!Number.isFinite(ageDays) || ageDays < 0 || ageDays > limitDays) {
    return { fechaEmision: current, fechaEmisionOriginal: original, changed: original !== current, reason: `fuera-de-plazo-${limitDays}-dias` };
  }

  return { fechaEmision: original, fechaEmisionOriginal: original, changed: false, reason: 'dentro-de-plazo' };
}

export function withIssueDateTrace(datosAdicionales: any, resolved: ReturnType<typeof resolveIssueDate>) {
  if (!resolved.changed) return datosAdicionales || null;
  const trace = {
    fecha_emision_original: resolved.fechaEmisionOriginal,
    fecha_emision_resuelta: resolved.fechaEmision,
    fecha_emision_motivo: resolved.reason,
  };
  if (Array.isArray(datosAdicionales)) return [...datosAdicionales, trace];
  if (datosAdicionales && typeof datosAdicionales === 'object') return { ...datosAdicionales, ...trace };
  return trace;
}
