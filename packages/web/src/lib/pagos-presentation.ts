export const money = new Intl.NumberFormat('es-PE', {
  style: 'currency',
  currency: 'PEN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function settlementStatusLabel(status) {
  return status === 'matched' ? 'Cruzada' : 'Sin cruzar';
}

export function settlementMethodLabel(method) {
  if (method === 'order_id') return 'ID de orden';
  if (method === 'sku_date_amount') return 'SKU, fecha y monto';
  if (method === 'sku_amount') return 'SKU y monto';
  return 'Sin cruce';
}

export function importSummary(item) {
  if (!item) return '';
  if (item.reused) return 'Este archivo ya estaba cargado.';
  return `${item.matchedCount} cruzadas · ${item.unmatchedCount} sin cruzar`;
}
