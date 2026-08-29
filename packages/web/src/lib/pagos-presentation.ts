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

export function importSummary(item: {
  reused?: boolean;
  replaced?: boolean;
  matchedCount?: number;
  unmatchedCount?: number;
  paidSalesCount?: number;
  filename?: string | null;
  importedAt?: string | null;
} | null | undefined) {
  if (!item) return '';
  if (item.reused) {
    const file = shortImportFilename(item.filename);
    const when = saleDateLabel(item.importedAt);
    if (file && when) return `Este CSV ya está cruzado · ${file} · ${when}`;
    if (file) return `Este CSV ya está cruzado · ${file}`;
    if (when) return `Este CSV ya está cruzado · ${when}`;
    return 'Este CSV ya está cruzado.';
  }
  if (item.replaced) {
    const cruzadas = `${item.matchedCount} cruzadas · ${item.unmatchedCount} sin cruzar · ${item.paidSalesCount || 0} pagadas`;
    return `Se volvió a cruzar · ${cruzadas}`;
  }
  return `${item.matchedCount} cruzadas · ${item.unmatchedCount} sin cruzar · ${item.paidSalesCount || 0} pagadas`;
}

export function shortImportFilename(name: string | null | undefined) {
  const raw = String(name || '').trim();
  const stripped = raw.replace(/^NewReportTransaction_/i, '');
  return stripped.replace(/_\d{4}-\d{2}-\d{2}T.*?(?=\.csv$|$)/i, '') || stripped || raw;
}

export function csvReadError(message: string | null | undefined) {
  const title = String(message || 'No se pudo leer el CSV.').trim() || 'No se pudo leer el CSV.';
  if (/vacío/i.test(title)) return { title, detail: 'Elige un archivo de Falabella.' };
  if (/8 MB|tamaño máximo/i.test(title)) return { title, detail: 'Parte el reporte o súbelo más liviano.' };
  if (/cabecer|columna/i.test(title)) return { title, detail: 'Usa el NewReportTransaction de Falabella.' };
  if (/líneas/i.test(title)) return { title, detail: 'El archivo no trae ventas.' };
  return { title, detail: 'Revisa el archivo y vuelve a subir.' };
}

export function reusedImportNotice(item: {
  filename?: string | null;
  importedAt?: string | null;
} | null | undefined) {
  const file = shortImportFilename(item?.filename);
  const when = saleDateLabel(item?.importedAt);
  return {
    title: 'Este CSV ya está cruzado.',
    detail: [file, when].filter(Boolean).join(' · '),
  };
}

export function formatElapsed(deciseconds: number) {
  const total = Math.max(0, Number(deciseconds) || 0) / 10;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

export const CSV_UPLOAD_MIN_MS = 1400;

export function remainingHoldMs(startedAt: number, minMs = CSV_UPLOAD_MIN_MS, now = Date.now()) {
  return Math.max(0, Number(minMs) - (Number(now) - Number(startedAt)));
}

export async function holdAtLeast(startedAt: number, minMs = CSV_UPLOAD_MIN_MS) {
  const rest = remainingHoldMs(startedAt, minMs);
  if (rest > 0) await new Promise((resolve) => setTimeout(resolve, rest));
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
  if (kind === 'shipping') return 'Logística';
  if (kind === 'buyer_shipping') return 'Envío del comprador';
  if (kind === 'refund') return 'Devolución';
  return 'Otro';
}

const PRODUCT_FILLER = /^(emergencia|trekking|camping|hiking|outdoor|mylar|pack|set|kit|oferta|promo|original|premium|nuevo|unisex)$/i;

export function shortProductName(name: string | null | undefined) {
  const text = repairProductText(String(name || '')).replace(/\s+/g, ' ').trim();
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
  matchedCount?: number | null;
  commissionRate?: number | null;
  shippingRate?: number | null;
  takeRate?: number | null;
} | null | undefined) {
  const count = Number(summary?.saleCount || 0);
  if (!count) return '';
  const ventas = count === 1 ? '1 venta' : `${count} ventas`;
  const matchedRaw = summary?.matchedCount;
  const matched = matchedRaw == null ? count : Number(matchedRaw);
  const cruce = matched === count ? '' : ` · ${matched} cruzadas`;
  return `${ventas}${cruce} · comisión ${percentLabel(summary?.commissionRate)} · logística ${percentLabel(summary?.shippingRate)} · se queda ${percentLabel(summary?.takeRate)}`;
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
  if (/√[≠≥°©∫±]|Ã[¡-ÿ]/.test(utf8)) {
    return repairProductText(utf8);
  }
  return utf8;
}

export function repairProductText(value: string | null | undefined) {
  return String(value || '')
    .replace(/√≠/g, 'í')
    .replace(/√≥/g, 'ó')
    .replace(/√°/g, 'á')
    .replace(/√©/g, 'é')
    .replace(/√∫/g, 'ú')
    .replace(/√±/g, 'ñ')
    .replace(/Ã­/g, 'í')
    .replace(/Ã³/g, 'ó')
    .replace(/Ã¡/g, 'á')
    .replace(/Ã©/g, 'é')
    .replace(/Ãº/g, 'ú')
    .replace(/Ã±/g, 'ñ');
}

function falabellaMediaUrl(sku?: string | null) {
  const value = String(sku || '').trim();
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return '';
  return `https://media.falabella.com/falabellaPE/${value}_01`;
}

export function productPhotoSrc(input: {
  imageUrl?: string | null;
  shopSku?: string | null;
  sku?: string | null;
} | null | undefined) {
  const value = String(input?.imageUrl || '').trim()
    || falabellaMediaUrl(input?.shopSku)
    || falabellaMediaUrl(input?.sku);
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:' && /(^|\.)falabella\.com$/i.test(parsed.hostname)) {
      return `/catalog/image?url=${encodeURIComponent(value)}`;
    }
  } catch {
    return value;
  }
  return value;
}

export function documentLabel(document: {
  kind?: string | null;
  number?: string | null;
} | null | undefined) {
  const number = String(document?.number || '').trim();
  if (document?.kind === 'factura') return number ? `Factura ${number}` : 'Factura emitida';
  if (document?.kind === 'boleta') return number ? `Boleta ${number}` : 'Boleta emitida';
  return 'Sin boleta ni factura';
}

export const PAGOS_SALES_PAGE = 2000;

export const PAGOS_COLUMN_COPY = {
  precio: { label: 'Precio', hint: 'Pagó el cliente' },
  commission: { label: 'Comisión', hint: '% del precio' },
  shipping: { label: 'Logística', hint: 'Cofinanciamiento' },
  take: { label: 'Se queda', hint: 'Comisión + logística' },
  neto: { label: 'Te llega', hint: 'Te depositan' },
} as const;

export function salesPageNote(shown: number, total: number) {
  const count = Number(total) || 0;
  const visible = Number(shown) || 0;
  if (!count) return '';
  if (visible >= count) return count === 1 ? '1 venta' : `${count} ventas`;
  return `Mostrando ${visible} de ${count}. Afina la búsqueda.`;
}

export function settlementCash(summary: {
  bruto?: number | null;
  neto?: number | null;
  take?: number | null;
  paidNeto?: number | null;
  pendingNeto?: number | null;
  paidCount?: number | null;
  pendingCount?: number | null;
} | null | undefined) {
  return {
    sold: Number(summary?.bruto || 0),
    arrives: Number(summary?.neto || 0),
    kept: Number(summary?.take || 0),
    paid: Number(summary?.paidNeto || 0),
    pending: Number(summary?.pendingNeto || 0),
    paidCount: Number(summary?.paidCount || 0),
    pendingCount: Number(summary?.pendingCount || 0),
  };
}

function ventasHint(count: number, empty: string) {
  if (!count) return empty;
  return count === 1 ? '1 venta' : `${count} ventas`;
}

export function settlementIndicators(summary: {
  saleCount?: number;
  bruto?: number | null;
  neto?: number | null;
  take?: number | null;
  paidNeto?: number | null;
  pendingNeto?: number | null;
  paidCount?: number | null;
  pendingCount?: number | null;
  takeRate?: number | null;
  ticket?: number | null;
  arriveTicket?: number | null;
  itemCount?: number | null;
  matchedCount?: number | null;
} | null | undefined) {
  const cash = settlementCash(summary);
  const sales = Number(summary?.saleCount || 0);
  const matched = Number(summary?.matchedCount || 0);
  const ticket = Number(summary?.ticket || 0) || (sales ? cash.sold / sales : 0);
  const items = Number(summary?.itemCount || 0);
  const receiveRate = cash.sold ? cash.arrives / cash.sold : null;
  const soldHint = matched && matched !== sales
    ? `${ventasHint(sales, 'Lo vendido')} · ${matched} cruzadas`
    : ventasHint(sales, 'Lo vendido');
  return [
    { id: 'sold', label: 'Precio', value: money.format(cash.sold), hint: soldHint },
    {
      id: 'arrives',
      label: 'Te llega',
      value: money.format(cash.arrives),
      hint: percentLabel(receiveRate) === '—' ? 'Te depositan' : percentLabel(receiveRate),
      tone: 'receive' as const,
    },
    {
      id: 'kept',
      label: 'Se queda',
      value: money.format(cash.kept),
      hint: percentLabel(summary?.takeRate) === '—' ? 'Comisión y logística' : percentLabel(summary?.takeRate),
      tone: 'take' as const,
    },
    { id: 'paid', label: 'Pagado', value: money.format(cash.paid), hint: ventasHint(cash.paidCount, 'Ya depositaron') },
    {
      id: 'pending',
      label: 'Pendiente',
      value: money.format(cash.pending),
      hint: ventasHint(cash.pendingCount, 'Aún no pagan'),
      tone: 'wait' as const,
    },
    { id: 'ticket', label: 'Ticket', value: money.format(ticket), hint: items ? `${items} u` : 'Por venta' },
  ];
}

