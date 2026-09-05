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
