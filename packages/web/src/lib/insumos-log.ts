const WHEN = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatInsumoQuantity(value: number) {
  return Number(value).toLocaleString('es-PE', { maximumFractionDigits: 2 });
}

export function formatInsumoChange(delta: number, after: number) {
  const signed = `${delta > 0 ? '+' : ''}${formatInsumoQuantity(delta)}`;
  return `${signed} · queda ${formatInsumoQuantity(after)}`;
}

export function formatInsumoWhen(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return WHEN.format(date);
}

export function formatInsumoActor(name?: string | null) {
  const trimmed = String(name || '').trim();
  return trimmed || 'Sin nombre';
}

export function nextQuantity(current: number, change: { delta?: number; absoluteTarget?: number }) {
  if (change.absoluteTarget != null) return Number(change.absoluteTarget);
  return current + Number(change.delta);
}

export function capErrorMessage(name: string, cap: number) {
  return `${name} no puede pasar de ${cap}.`;
}
