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

export function unmatchedReasonLabel(reason) {
  if (reason === 'ambiguous_order_id') return 'Varias ventas con el mismo pedido';
  if (reason === 'unknown_order_id') return 'Pedido no está en las ventas';
  if (reason === 'ambiguous_sku_date_amount') return 'Varias ventas con el mismo SKU, fecha y monto';
  if (reason === 'ambiguous_sku_amount') return 'Varias ventas con el mismo SKU y monto';
  return 'Sin match único';
}

export function paymentStatusLabel(status) {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'pagado' || value === 'paid') return 'Pagado';
  if (value === 'no pagado' || value === 'unpaid' || value === 'not paid') return 'No pagado';
  return status || '—';
}

export function importSummary(item) {
  if (!item) return '';
  if (item.reused) return 'Este archivo ya estaba cargado.';
  return `${item.matchedCount} cruzadas · ${item.unmatchedCount} sin cruzar · ${item.paidSalesCount || 0} pagadas`;
}

function headerLooksLikeSettlement(text) {
  const header = String(text || '').split(/\r?\n/).find((line) => line.trim()) || '';
  const normalized = header
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  return normalized.includes('del orden') || normalized.includes('de pedido') || normalized.includes('estado de pago');
}

export function decodeSettlementCsv(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  let latin = '';
  try {
    latin = new TextDecoder('windows-1252').decode(bytes);
  } catch {
    return utf8;
  }
  if (utf8.includes('\uFFFD') && /[áéíóúñ°]/i.test(latin) && headerLooksLikeSettlement(latin)) {
    return latin;
  }
  return utf8;
}
