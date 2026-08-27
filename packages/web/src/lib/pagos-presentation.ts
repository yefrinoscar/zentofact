export const money = new Intl.NumberFormat('es-PE', {
  style: 'currency',
  currency: 'PEN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function settlementStatusLabel(status: string) {
  return status === 'matched' ? 'Cruzada' : 'Sin cruzar';
}

export function settlementMethodLabel(method: string | null | undefined) {
  if (method === 'order_id') return 'ID de orden';
  if (method === 'sku_date_amount') return 'SKU, fecha y monto';
  if (method === 'sku_amount') return 'SKU y monto';
  return 'Sin cruce';
}

export function unmatchedReasonLabel(reason: string | null | undefined) {
  if (reason === 'ambiguous_order_id') return 'Varias ventas con el mismo pedido';
  if (reason === 'unknown_order_id') return 'Pedido no está en las ventas';
  if (reason === 'ambiguous_sku_date_amount') return 'Varias ventas con el mismo SKU, fecha y monto';
  if (reason === 'ambiguous_sku_amount') return 'Varias ventas con el mismo SKU y monto';
  return 'Sin match único';
}

export function paymentStatusLabel(status: string | null | undefined) {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'pagado' || value === 'paid') return 'Pagado';
  if (value === 'no pagado' || value === 'unpaid' || value === 'not paid') return 'No pagado';
  return status || '—';
}

export function importSummary(item: { reused?: boolean; matchedCount?: number; unmatchedCount?: number; paidSalesCount?: number } | null | undefined) {
  if (!item) return '';
  if (item.reused) return 'Este archivo ya estaba cargado.';
  return `${item.matchedCount} cruzadas · ${item.unmatchedCount} sin cruzar · ${item.paidSalesCount || 0} pagadas`;
}

function headerLooksLikeSettlement(text: string) {
  const header = String(text || '').split(/\r?\n/).find((line) => line.trim()) || '';
  const normalized = header
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  return normalized.includes('del orden') || normalized.includes('de pedido') || normalized.includes('estado de pago');
}

export const percent = new Intl.NumberFormat('es-PE', {
  style: 'percent',
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

export function percentLabel(rate: number | null | undefined) {
  if (rate == null || !Number.isFinite(Number(rate))) return '—';
  return percent.format(Number(rate));
}

export function chargeKindLabel(kind: string | null | undefined) {
  if (kind === 'sale') return 'Precio';
  if (kind === 'commission') return 'Comisión';
  if (kind === 'shipping') return 'Cobro envío';
  if (kind === 'buyer_shipping') return 'Envío comprador';
  if (kind === 'refund') return 'Devolución';
  return 'Otro';
}

const PRODUCT_FILLER = /^(emergencia|trekking|camping|hiking|outdoor|mylar|pack|set|kit|oferta|promo|original|premium|nuevo|unisex)$/i;

export function shortProductName(name: string | null | undefined) {
  const text = String(name || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const kept: string[] = [];
  for (const word of text.split(' ')) {
    if (PRODUCT_FILLER.test(word) && kept.length >= 2) continue;
    kept.push(word);
    if (kept.length >= 4 || kept.join(' ').length >= 36) break;
  }
  return kept.join(' ') || text;
}

export function skuLabel(skus: string[] | null | undefined) {
  const list = (skus || []).map((sku) => String(sku || '').trim()).filter(Boolean);
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  return `${list[0]} +${list.length - 1}`;
}

export function unitsLabel(count: number | null | undefined) {
  const quantity = Number(count || 0);
  if (!Number.isFinite(quantity) || quantity < 2) return '';
  return `${quantity} u`;
}

export function saleDateLabel(date: string | null | undefined) {
  const day = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  return new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short' }).format(new Date(`${day}T12:00:00`));
}

export function saleOverview(summary: {
  saleCount?: number;
  commissionRate?: number | null;
  shippingRate?: number | null;
  takeRate?: number | null;
} | null | undefined) {
  if (!summary?.saleCount) return '';
  return `${summary.saleCount} ventas · comisión ${percentLabel(summary.commissionRate)} · cobro envío ${percentLabel(summary.shippingRate)} · se queda ${percentLabel(summary.takeRate)}`;
}

export function decodeSettlementCsv(buffer: ArrayBuffer | Uint8Array) {
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

