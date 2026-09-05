import { documentDateRangeForLastDays, type DocumentDateRange } from './documentDateRange.ts';

export type CancellationKind = 'cancelled' | 'returned';

export type CanceledCreditNoteTone = 'done' | 'review' | 'pending' | 'none';

export type CanceledOrderRow = {
  fulfillmentStatus?: string | null;
  orderStatus?: string | null;
  stockApproval?: 'pending' | 'approved' | 'not_required' | null;
  creditNoteNumber?: string | null;
  documentNumber?: string | null;
  documentKind?: string | null;
};

export function cancellationKind(row: Pick<CanceledOrderRow, 'fulfillmentStatus' | 'orderStatus' | 'stockApproval'>): CancellationKind {
  if (row.fulfillmentStatus === 'returned') return 'returned';
  if (row.stockApproval === 'pending' || row.stockApproval === 'approved') return 'returned';
  return 'cancelled';
}

export function cancellationKindLabel(kind: CancellationKind) {
  return kind === 'returned' ? 'Devuelta' : 'Cancelada';
}

export function stockApprovalLabel(status?: string | null) {
  if (status === 'pending') return 'Por aprobar';
  if (status === 'approved') return 'Stock aprobado';
  return null;
}

export type ReturnLineItem = {
  quantity?: number | null;
  approvalStatus?: string | null;
  stockQuantity?: number | null;
  mermaQuantity?: number | null;
};

export type ReturnLineDecision = {
  orderItemId: number;
  quantity: number;
  stockQuantity: number;
  mermaQuantity: number;
};

export function extraProductsLabel(count: number) {
  if (count <= 1) return null;
  return `Ver ${count} productos`;
}

export function returnOutcomeLabel(items: ReturnLineItem[] = []) {
  let stock = 0;
  let merma = 0;
  for (const item of items) {
    if (item.approvalStatus && item.approvalStatus !== 'approved') continue;
    const hasSplit = item.stockQuantity != null || item.mermaQuantity != null;
    if (!hasSplit) continue;
    stock += Number(item.stockQuantity || 0);
    merma += Number(item.mermaQuantity || 0);
  }
  if (merma > 0 && stock > 0) return 'Stock y merma';
  if (merma > 0) return 'Merma';
  return null;
}

export function returnDecisionSummary(lines: ReturnLineDecision[]) {
  const stock = lines.reduce((sum, line) => sum + Number(line.stockQuantity || 0), 0);
  const merma = lines.reduce((sum, line) => sum + Number(line.mermaQuantity || 0), 0);
  const balanced = lines.every((line) => (
    Number(line.stockQuantity) >= 0
    && Number(line.mermaQuantity) >= 0
    && Number(line.stockQuantity) + Number(line.mermaQuantity) === Number(line.quantity)
  ));
  return { stock, merma, balanced };
}

export function returnDecisionHelper(summary: { stock: number; merma: number }) {
  const stock = Number(summary.stock || 0);
  const merma = Number(summary.merma || 0);
  if (stock > 0 && merma > 0) {
    return `${unitLabel(stock)} a stock. ${unitLabel(merma)} a merma.`;
  }
  if (merma > 0) return `${unitLabel(merma)} a merma.`;
  if (stock > 0) return `${unitLabel(stock)} a stock.`;
  return 'Marca stock o merma en cada producto.';
}

export function returnLineDecisionLabel(line: Pick<ReturnLineDecision, 'stockQuantity' | 'mermaQuantity'>) {
  const stock = Number(line.stockQuantity || 0);
  const merma = Number(line.mermaQuantity || 0);
  if (stock > 0 && merma > 0) return `${unitLabel(stock)} a stock · ${unitLabel(merma)} a merma`;
  if (merma > 0) return `${unitLabel(merma)} a merma`;
  if (stock > 0) return `${unitLabel(stock)} a stock`;
  return 'Marca stock o merma';
}

export function setReturnLineStock(line: ReturnLineDecision, stockQuantity: number): ReturnLineDecision {
  const quantity = Number(line.quantity);
  const stock = clampQuantity(stockQuantity, 0, quantity);
  return { ...line, stockQuantity: stock, mermaQuantity: quantity - stock };
}

export function nudgeReturnLineMerma(line: ReturnLineDecision, delta: number): ReturnLineDecision {
  return setReturnLineStock(line, Number(line.stockQuantity) - delta);
}

function unitLabel(count: number) {
  return count === 1 ? '1 u' : `${count} u`;
}

function clampQuantity(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function documentKindLabel(kind?: string | null) {
  if (kind === 'factura') return 'Factura';
  if (kind === 'boleta') return 'Boleta';
  return '—';
}

function trimmedNumber(value?: string | null) {
  const number = String(value || '').trim();
  return number || null;
}

/** Tag visible: Boleta o Factura. El número sale al pasar el mouse. */
export function documentTag(kind?: string | null, number?: string | null) {
  const label = documentKindLabel(kind);
  if (label === '—') return null;
  return { label, number: trimmedNumber(number) };
}

export function creditNoteAction(row: Pick<CanceledOrderRow, 'creditNoteNumber' | 'documentNumber' | 'documentKind'>) {
  const number = trimmedNumber(row.creditNoteNumber);
  if (number) {
    return { tone: 'done' as CanceledCreditNoteTone, label: 'NC', number };
  }
  if (row.documentNumber || row.documentKind === 'boleta' || row.documentKind === 'factura') {
    return { tone: 'pending' as CanceledCreditNoteTone, label: 'Sin NC', number: null };
  }
  return { tone: 'none' as CanceledCreditNoteTone, label: 'Sin documento', number: null };
}

export function parseCanceledDateRange(searchParams: URLSearchParams): DocumentDateRange {
  const fallback = documentDateRangeForLastDays(30);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return fallback;
  }
  return { from, to };
}
