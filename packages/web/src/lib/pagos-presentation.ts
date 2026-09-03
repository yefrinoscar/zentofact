import { read as readWorkbook, utils as xlsxUtils } from 'xlsx';
import { headerLooksLikeInvoiceReport, isInvoiceReportFilename } from './pagos-invoice-report.ts';

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

export type PaymentStatusTone = 'paid' | 'unpaid' | 'scheduled' | 'returned' | 'unknown';

export function paymentStatusTone(status: string | null | undefined, returned?: boolean): PaymentStatusTone {
  if (returned) return 'returned';
  const value = String(status || '').trim().toLowerCase();
  if (value.includes('devol')) return 'returned';
  if (value === 'pagado' || value === 'paid') return 'paid';
  if (value === 'no pagado' || value === 'unpaid' || value === 'not paid') return 'unpaid';
  if (value.includes('programado')) return 'scheduled';
  return 'unknown';
}

export function paymentStatusLabel(status: string | null | undefined, returned?: boolean) {
  const tone = paymentStatusTone(status, returned);
  if (tone === 'returned') return 'Devolución';
  if (tone === 'paid') return 'Pagado';
  if (tone === 'unpaid') return 'No pagado';
  if (tone === 'scheduled') return 'Programado';
  return String(status || '').trim() || '—';
}

export const PAYMENT_FILTERS = [
  { value: 'all', label: 'Todos', trigger: 'Pago' },
  { value: 'pagado', label: 'Pagados', trigger: 'Pagados' },
  { value: 'no-pagado', label: 'No pagados', trigger: 'No pagados' },
  { value: 'devolucion-pagado', label: 'Devolución pagada', trigger: 'Dev. pagada' },
  { value: 'devolucion-no-pagado', label: 'Devolución no pagada', trigger: 'Dev. no pagada' },
] as const;

export type PaymentFilterValue = (typeof PAYMENT_FILTERS)[number]['value'];

export function paymentFilterLabel(value: string | null | undefined, kind: 'label' | 'trigger' = 'label') {
  const match = PAYMENT_FILTERS.find((item) => item.value === value);
  if (!match) return kind === 'trigger' ? 'Pago' : 'Todos';
  return match[kind];
}

export function teLlegaHint(sale: {
  returned?: boolean | null;
  neto?: number | null;
  shipping?: number | null;
} | null | undefined) {
  if (sale?.returned) {
    if (Number(sale.shipping || 0) > 0) return 'No ganas. La logística suele quedarse.';
    return 'Producto y comisión se anulan. No te queda venta.';
  }
  if (Number(sale?.neto || 0) < 0) return 'Falabella cobró más que el precio.';
  return 'Lo que te depositan.';
}

export const IGV_RATE = 0.18;

function money2(value: number | null | undefined) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function igvSplit(gross: number | null | undefined) {
  const amount = money2(gross || 0);
  const net = money2(amount / (1 + IGV_RATE));
  return { gross: amount, net, igv: money2(amount - net) };
}

export function saleIgvStory(sale: {
  bruto?: number | null;
  commission?: number | null;
  shipping?: number | null;
  buyerShippingPaid?: number | null;
  orderShipping?: number | null;
  returned?: boolean | null;
  invoiceCharges?: {
    commission?: { net?: number; igv?: number; gross?: number } | null;
    logistics?: { net?: number; igv?: number; gross?: number } | null;
    buyer_shipping?: { net?: number; igv?: number; gross?: number } | null;
    ads?: { net?: number; igv?: number; gross?: number } | null;
  } | null;
} | null | undefined) {
  const returned = Boolean(sale?.returned);
  const product = returned ? 0 : money2(sale?.bruto);
  const envio = returned
    ? 0
    : sale?.orderShipping != null && Number.isFinite(Number(sale.orderShipping))
      ? Math.max(0, money2(sale.orderShipping))
      : Math.max(0, money2(sale?.buyerShippingPaid));
  const settlementCommission = money2(sale?.commission);
  const settlementLogistics = money2(sale?.shipping);
  const productSplit = igvSplit(product);
  const envioSplit = igvSplit(envio);
  const boleta = igvSplit(product + envio);
  const invoice = returned ? null : sale?.invoiceCharges || null;
  const commissionSplit = invoiceSplit(invoice?.commission) || igvSplit(settlementCommission);
  const logisticsSplit = addSplits(
    invoiceSplit(invoice?.logistics) || igvSplit(settlementLogistics),
    invoiceSplit(invoice?.buyer_shipping),
  ) || igvSplit(settlementLogistics);
  const adsSplit = invoiceSplit(invoice?.ads);
  const factura = invoice
    ? addSplits(addSplits(commissionSplit, logisticsSplit), adsSplit) || commissionSplit
    : igvSplit(settlementCommission + settlementLogistics);
  const queda = money2(boleta.net - factura.net);
  return {
    product,
    productSplit,
    envio,
    envioSplit,
    boleta,
    commission: commissionSplit.gross,
    commissionSplit,
    logistics: logisticsSplit.gross,
    logisticsSplit,
    adsSplit,
    factura,
    productNet: productSplit.net,
    commissionNet: commissionSplit.net,
    shippingAdjust: money2(queda - (productSplit.net - commissionSplit.net)),
    queda,
  };
}

function invoiceSplit(row: { net?: number; igv?: number; gross?: number } | null | undefined) {
  if (!row) return null;
  const gross = money2(row.gross);
  const net = money2(row.net);
  const igv = money2(row.igv);
  if (!gross && !net && !igv) return null;
  return { gross, net, igv };
}

function addSplits(
  left: { gross: number; net: number; igv: number } | null | undefined,
  right: { gross: number; net: number; igv: number } | null | undefined,
) {
  if (!left) return right || null;
  if (!right) return left;
  return {
    gross: money2(left.gross + right.gross),
    net: money2(left.net + right.net),
    igv: money2(left.igv + right.igv),
  };
}

export function settlementStatementTotals(sales: Parameters<typeof saleIgvStory>[0][] | null | undefined) {
  return (sales || []).reduce((totals, sale) => {
    const story = saleIgvStory(sale);
    const returned = Boolean(sale?.returned);
    return {
      product: money2(totals.product + story.productSplit.net),
      envio: money2(totals.envio + story.envioSplit.net),
      boleta: money2(totals.boleta + story.boleta.net),
      commission: money2(totals.commission + story.commissionSplit.net),
      logistics: money2(totals.logistics + story.logisticsSplit.net),
      total: money2(totals.total + story.factura.net),
      ganas: money2(totals.ganas + story.queda),
      returnLoss: money2(totals.returnLoss + (returned && story.queda < 0 ? story.queda : 0)),
      returnCount: totals.returnCount + (returned ? 1 : 0),
    };
  }, {
    product: 0,
    envio: 0,
    boleta: 0,
    commission: 0,
    logistics: 0,
    total: 0,
    ganas: 0,
    returnLoss: 0,
    returnCount: 0,
  } as {
    product: number;
    envio: number;
    boleta: number;
    commission: number;
    logistics: number;
    total: number;
    ganas: number;
    returnLoss: number;
    returnCount: number;
  });
}

export function settlementPair(charged?: number | null, reversed?: number | null) {
  const up = Math.round(Number(charged || 0) * 100) / 100;
  const down = Math.round(Number(reversed || 0) * 100) / 100;
  if (up && down) return { amount: up, reversal: down };
  if (down && !up) return { amount: down, reversal: null as number | null };
  return { amount: up, reversal: null as number | null };
}

export function returnProductPair(
  charged?: number | null,
  reversed?: number | null,
  fallback = 0,
) {
  const pair = settlementPair(charged, reversed);
  const amount = pair.amount || money2(fallback);
  if (amount > 0 && pair.reversal == null) return { amount, reversal: money2(-amount) };
  return pair;
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
    if (file && when) return `Este archivo ya está cruzado · ${file} · ${when}`;
    if (file) return `Este archivo ya está cruzado · ${file}`;
    if (when) return `Este archivo ya está cruzado · ${when}`;
    return 'Este archivo ya está cruzado.';
  }
  if (item.replaced) {
    const cruzadas = `${item.matchedCount} cruzadas · ${item.unmatchedCount} sin cruzar · ${item.paidSalesCount || 0} pagadas`;
    return `Se volvió a cruzar · ${cruzadas}`;
  }
  return `${item.matchedCount} cruzadas · ${item.unmatchedCount} sin cruzar · ${item.paidSalesCount || 0} pagadas`;
}

export function shortImportFilename(name: string | null | undefined) {
  const raw = String(name || '').trim();
  const stripped = raw.replace(/^(NewReportTransaction_|InvoiceReport_)/i, '');
  return stripped.replace(/_\d{4}-\d{2}-\d{2}T.*?(?=\.(csv|xlsx|xls|xlsm)$|$)/i, '') || stripped || raw;
}

export const SUCCESS_NOTICE_MS = 5000;

export function csvReadError(message: string | null | undefined) {
  const title = String(message || 'No se pudo leer el archivo.').trim() || 'No se pudo leer el archivo.';
  if (/vacío/i.test(title)) return { title, detail: 'Elige un archivo de Falabella.' };
  if (/reporte de facturas/i.test(title)) return { title, detail: '' };
  if (/estado de cuenta\. Usa Subir archivo/i.test(title)) return { title, detail: '' };
  if (/8 MB|tamaño máximo/i.test(title)) return { title, detail: 'Parte el reporte o súbelo más liviano.' };
  if (/cabecer|columna|hoja/i.test(title)) return { title, detail: '' };
  if (/reporte de facturas no trae/i.test(title)) return { title, detail: 'Revisa el Excel InvoiceReport.' };
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
    title: 'Este archivo ya está cruzado.',
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

function normalizeSettlementHeader(text: string) {
  return String(text || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

function lineLooksLikeSettlementHeader(text: string) {
  const normalized = normalizeSettlementHeader(text);
  return normalized.includes('estado de pago')
    || normalized.includes('del orden')
    || normalized.includes('n de orden')
    || normalized.includes('de pedido');
}

function headerLooksLikeSettlement(text: string) {
  return String(text || '').split(/\r?\n/).some((line) => lineLooksLikeSettlementHeader(line));
}

function expandSheetRange(sheet: { '!ref'?: string } & Record<string, unknown>) {
  const keys = Object.keys(sheet).filter((key) => /^[A-Z]+[0-9]+$/.test(key));
  if (!keys.length) return;
  const range = sheet['!ref']
    ? xlsxUtils.decode_range(sheet['!ref'])
    : { s: { r: Number.POSITIVE_INFINITY, c: Number.POSITIVE_INFINITY }, e: { r: 0, c: 0 } };
  for (const key of keys) {
    const cell = xlsxUtils.decode_cell(key);
    if (cell.r < range.s.r) range.s.r = cell.r;
    if (cell.c < range.s.c) range.s.c = cell.c;
    if (cell.r > range.e.r) range.e.r = cell.r;
    if (cell.c > range.e.c) range.e.c = cell.c;
  }
  if (!Number.isFinite(range.s.r) || !Number.isFinite(range.s.c)) return;
  sheet['!ref'] = xlsxUtils.encode_range(range);
}

function settlementRowsFromSheet(sheet: { '!ref'?: string } & Record<string, unknown>) {
  expandSheetRange(sheet);
  const rows = xlsxUtils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  }) as unknown[][];
  const headerIndex = rows.findIndex((row) => (
    lineLooksLikeSettlementHeader((row || []).map((cell) => String(cell ?? '')).join(','))
  ));
  if (headerIndex < 0) return rows;
  return rows.slice(headerIndex);
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

export function monthKey(date: string | null | undefined) {
  const day = String(date || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day.slice(0, 7) : '';
}

export function monthLabel(month: string | null | undefined) {
  const value = String(month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(value)) return '';
  return new Intl.DateTimeFormat('es-PE', { month: 'short', year: 'numeric' }).format(new Date(`${value}-01T12:00:00`));
}

export function saleDatesHint(sale: {
  date?: string | null;
  paidDate?: string | null;
} | null | undefined) {
  const order = saleDateLabel(sale?.date);
  const paid = saleDateLabel(sale?.paidDate);
  if (order && paid) return `orden ${order} · pago ${paid}`;
  if (order) return `orden ${order}`;
  if (paid) return `pago ${paid}`;
  return '';
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
  return utf8;
}

export function isSettlementSpreadsheet(filename: string, mime = '') {
  const name = String(filename || '').toLowerCase();
  const type = String(mime || '').toLowerCase();
  if (name.endsWith('.csv')) return false;
  return /\.(xlsx|xls|xlsm)$/.test(name)
    || type.includes('spreadsheetml')
    || (type.includes('excel') && !type.includes('csv'));
}

export function decodeSettlementSpreadsheet(buffer: ArrayBuffer | Uint8Array) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  const workbook = readWorkbook(bytes, { type: 'array', cellDates: true, raw: false });
  const names = workbook.SheetNames || [];
  if (!names.length) throw new Error('El Excel no tiene hojas.');
  let rows: unknown[][] = [];
  for (const name of names) {
    const next = settlementRowsFromSheet(workbook.Sheets[name] as { '!ref'?: string } & Record<string, unknown>);
    const header = (next[0] || []).map((cell) => String(cell ?? '')).join(',');
    if (headerLooksLikeInvoiceReport(header)) {
      throw new Error('Este es un reporte de facturas. Usa Subir facturas.');
    }
    if (lineLooksLikeSettlementHeader(header)) {
      rows = next;
      break;
    }
    if (!rows.length) rows = next;
  }
  const csv = xlsxUtils.sheet_to_csv(xlsxUtils.aoa_to_sheet(rows), {
    FS: ',',
    RS: '\n',
    dateNF: 'yyyy-mm-dd',
  });
  if (!String(csv || '').trim()) throw new Error('El Excel está vacío.');
  return csv;
}

export async function readSettlementUpload(file: {
  name?: string;
  type?: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}) {
  if (isInvoiceReportFilename(file.name)) {
    throw new Error('Este es un reporte de facturas. Usa Subir facturas.');
  }
  const buffer = await file.arrayBuffer();
  if (isSettlementSpreadsheet(file.name || '', file.type || '')) {
    return decodeSettlementSpreadsheet(buffer);
  }
  const csv = decodeSettlementCsv(buffer);
  if (headerLooksLikeInvoiceReport(csv)) {
    throw new Error('Este es un reporte de facturas. Usa Subir facturas.');
  }
  return csv;
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
  dates: { label: 'Fechas', hint: 'Orden · pago' },
  precio: { label: 'Precio', hint: 'Producto' },
  envio: { label: 'Envío', hint: 'De la orden' },
  boleta: { label: 'Boleta', hint: 'Sin IGV' },
  comision: { label: 'Comisión', hint: 'Sin IGV' },
  logistica: { label: 'Logística', hint: 'Sin IGV' },
  total: { label: 'Total', hint: 'Sin IGV' },
  ganas: { label: 'Ganas', hint: 'Lo que te queda' },
  factura: { label: 'Factura', hint: 'Falabella' },
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

function countHint(count: number, singular: string, plural: string, empty: string) {
  if (!count) return empty;
  return count === 1 ? `1 ${singular}` : `${count} ${plural}`;
}

function roundMoney(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function smoothNumericSeries(values: number[], perSegment = 8) {
  const source = (values || []).map((value) => Number(value) || 0);
  if (source.length < 2) return source.slice();
  if (source.length === 2) {
    const out = [];
    for (let step = 0; step < perSegment; step += 1) {
      const t = step / perSegment;
      out.push(roundMoney(source[0] + (source[1] - source[0]) * t));
    }
    out.push(source[1]);
    return out;
  }
  const out: number[] = [];
  for (let index = 0; index < source.length - 1; index += 1) {
    const p0 = source[Math.max(0, index - 1)];
    const p1 = source[index];
    const p2 = source[index + 1];
    const p3 = source[Math.min(source.length - 1, index + 2)];
    for (let step = 0; step < perSegment; step += 1) {
      const t = step / perSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push(roundMoney(
        0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3),
      ));
    }
  }
  out.push(source[source.length - 1]);
  return out;
}

export function settlementDailySeries(sales: Array<{
  date?: string | null;
  paid?: boolean;
  bruto?: number | null;
  neto?: number | null;
  commission?: number | null;
  shipping?: number | null;
}> | null | undefined) {
  const days = new Map<string, {
    date: string;
    facturado: number;
    neto: number;
    commission: number;
    shipping: number;
    paid: number;
    pending: number;
    take: number;
  }>();
  for (const sale of sales || []) {
    const date = String(sale.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const current = days.get(date) || {
      date,
      facturado: 0,
      neto: 0,
      commission: 0,
      shipping: 0,
      paid: 0,
      pending: 0,
      take: 0,
    };
    const neto = Number(sale.neto || 0);
    current.facturado = roundMoney(current.facturado + Number(sale.bruto || 0));
    current.neto = roundMoney(current.neto + neto);
    current.commission = roundMoney(current.commission + Number(sale.commission || 0));
    current.shipping = roundMoney(current.shipping + Number(sale.shipping || 0));
    current.take = roundMoney(current.commission + current.shipping);
    if (sale.paid) current.paid = roundMoney(current.paid + neto);
    else current.pending = roundMoney(current.pending + neto);
    days.set(date, current);
  }
  return [...days.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function livelinePointsFromDays(
  days: Array<Record<string, number | string>>,
  key: string,
) {
  const rows = (days || []).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row.date || '')));
  if (!rows.length) return livelinePointsFromValues([0]);
  const values = rows.map((row) => Number(row[key] || 0));
  const dense = smoothNumericSeries(values.length >= 2 ? values : [values[0], values[0]]);
  const start = Date.parse(`${rows[0].date}T12:00:00-05:00`) / 1000;
  const end = Date.parse(`${rows[rows.length - 1].date}T12:00:00-05:00`) / 1000;
  const span = Math.max(86400, end - start);
  if (dense.length < 2) {
    return [
      { time: Math.round(start), value: dense[0] || 0 },
      { time: Math.round(start + span), value: dense[0] || 0 },
    ];
  }
  const gap = span / (dense.length - 1);
  return dense.map((value, index) => ({
    time: Math.round(start + index * gap),
    value,
  }));
}

export function livelineWindowSecs(points: Array<{ time: number }>) {
  if (!points.length) return 86400;
  const now = Math.floor(Date.now() / 1000);
  return Math.max(86400, now - points[0].time + 43200);
}

export function formatLivelineDay(time: number) {
  return saleDateLabel(new Date(Number(time) * 1000).toISOString().slice(0, 10));
}

export function livelinePointsFromValues(values: number[], spanSecs = 48) {
  const source = (values || []).map((value) => Number(value) || 0);
  const dense = smoothNumericSeries(source.length >= 2 ? source : [source[0] || 0, source[0] || 0]);
  const end = Math.floor(Date.now() / 1000);
  if (dense.length < 2) {
    const value = dense[0] || 0;
    return [
      { time: end - spanSecs, value },
      { time: end, value },
    ];
  }
  const gap = spanSecs / (dense.length - 1);
  return dense.map((value, index) => ({
    time: Math.round(end - (dense.length - 1 - index) * gap),
    value,
  }));
}

export function settlementTrendPoints(
  days: Array<Record<string, number | string>>,
  keys: string[],
) {
  const rows = days || [];
  if (!rows.length || !keys.length) return [];
  if (rows.length === 1) {
    const first = Object.fromEntries(keys.map((key) => [key, Number(rows[0][key] || 0)]));
    return [{ i: 0, ...first }, { i: 1, ...first }];
  }
  const columns = Object.fromEntries(
    keys.map((key) => [key, smoothNumericSeries(rows.map((row) => Number(row[key] || 0)))]),
  );
  const length = columns[keys[0]]?.length || 0;
  return Array.from({ length }, (_, index) => {
    const point: Record<string, number> = { i: index };
    for (const key of keys) point[key] = columns[key][index];
    return point;
  });
}

export function waffleOutOf100(input: {
  sold?: number | null;
  commission?: number | null;
  shipping?: number | null;
}) {
  const sold = Number(input?.sold || 0);
  const commission = Math.max(0, Number(input?.commission || 0));
  const shipping = Math.max(0, Number(input?.shipping || 0));
  if (sold <= 0) {
    return {
      counts: { commission: 0, shipping: 0, arrives: 100 },
      cells: Array.from({ length: 100 }, () => 'arrives' as const),
    };
  }
  const shares = [commission / sold, shipping / sold, Math.max(0, 1 - (commission + shipping) / sold)];
  const raw = shares.map((share) => share * 100);
  const floors = raw.map((value) => Math.floor(value));
  let rest = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, frac: value - floors[index] }))
    .sort((left, right) => right.frac - left.frac);
  const counts = floors.slice();
  for (let step = 0; step < rest; step += 1) counts[order[step].index] += 1;
  const keys = ['commission', 'shipping', 'arrives'] as const;
  const cells = keys.flatMap((key, index) => Array.from({ length: counts[index] }, () => key));
  return {
    counts: { commission: counts[0], shipping: counts[1], arrives: counts[2] },
    cells,
  };
}

export function settlementCharts(summary: {
  saleCount?: number;
  bruto?: number | null;
  neto?: number | null;
  take?: number | null;
  commission?: number | null;
  shipping?: number | null;
  paidNeto?: number | null;
  pendingNeto?: number | null;
  paidCount?: number | null;
  pendingCount?: number | null;
  takeRate?: number | null;
  matchedCount?: number | null;
} | null | undefined) {
  const cash = settlementCash(summary);
  const sales = Number(summary?.saleCount || 0);
  const matched = Number(summary?.matchedCount || 0);
  const soldHint = matched && matched !== sales
    ? `${ventasHint(sales, 'Lo facturado')} · ${matched} cruzadas`
    : ventasHint(sales, 'Lo facturado');
  const takeHint = percentLabel(summary?.takeRate) === '—'
    ? 'Comisión y logística'
    : `${percentLabel(summary?.takeRate)} del facturado`;
  const paidHint = countHint(cash.paidCount, 'pagada', 'pagadas', 'Ya depositaron');
  const pendingHint = countHint(cash.pendingCount, 'pendiente', 'pendientes', 'Aún no pagan');
  const commission = Number(summary?.commission || 0);
  const shipping = Number(summary?.shipping || 0);
  return [
    {
      id: 'billed',
      kind: 'compare' as const,
      hint: soldHint,
      hero: undefined,
      items: [
        { key: 'facturado', label: 'Facturado', value: cash.sold, withoutIgv: igvSplit(cash.sold).net, tone: 'neutral' as const },
        { key: 'neto', label: 'Neto', value: cash.arrives, withoutIgv: igvSplit(cash.arrives).net, tone: 'receive' as const },
      ],
    },
    {
      id: 'fees',
      kind: 'waffle' as const,
      hint: takeHint,
      total: cash.kept,
      hero: { key: 'take', label: 'Se queda', value: cash.kept, withoutIgv: igvSplit(cash.kept).net, tone: 'neutral' as const },
      items: [
        { key: 'commission', label: 'Comisión', value: commission, withoutIgv: igvSplit(commission).net, tone: 'take' as const },
        { key: 'shipping', label: 'Logística', value: shipping, withoutIgv: igvSplit(shipping).net, tone: 'wait' as const },
      ],
    },
    {
      id: 'payout',
      kind: 'pie' as const,
      hint: cash.paidCount || cash.pendingCount ? `${paidHint} · ${pendingHint}` : 'Depósito',
      total: cash.arrives,
      hero: undefined,
      items: [
        { key: 'paid', label: 'Pagado', value: cash.paid, withoutIgv: igvSplit(cash.paid).net, tone: 'receive' as const },
        { key: 'pending', label: 'Pendiente', value: cash.pending, tone: 'wait' as const },
      ],
    },
  ];
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
    { id: 'sold', label: 'Facturado', value: money.format(cash.sold), hint: soldHint },
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

