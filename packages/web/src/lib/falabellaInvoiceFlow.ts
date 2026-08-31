export type InvoiceFlowBucket = 'ready_to_invoice' | 'has_document' | 'not_ready' | 'review';
export type InvoiceFlowFilter = InvoiceFlowBucket;
export type SalesDocumentKind = 'BOLETA' | 'FACTURA';

type FilterableInvoiceFlowRow = {
  bucket: InvoiceFlowBucket;
  hasDocument: boolean;
};

type DocumentAmountRow = FilterableInvoiceFlowRow & {
  total: number;
};

type SalesDocumentStatusRow = {
  hasSalesDocument: boolean;
  salesDocumentStatus: string;
};

type SalesDocumentRow = SalesDocumentStatusRow & {
  salesDocumentKind?: SalesDocumentKind;
  salesDocumentAmount: number;
};

type FinancialOrderRow = {
  statusKey: string;
  hasSalesDocument: boolean;
};

export function matchesInvoiceFlowFilter(
  row: FilterableInvoiceFlowRow,
  filter: InvoiceFlowFilter,
) {
  return filter === 'has_document' ? row.hasDocument : row.bucket === filter;
}

export function summarizeDocumentRows(rows: DocumentAmountRow[]) {
  return rows.reduce(
    (summary, row) => row.hasDocument
      ? { count: summary.count + 1, amount: summary.amount + row.total }
      : summary,
    { count: 0, amount: 0 },
  );
}

export function shouldIncludeInFinancialTotals(row: FinancialOrderRow) {
  const status = row.statusKey.trim().toLowerCase();
  const canceledOrReturned = status.includes('canceled')
    || status.includes('cancelled')
    || status.includes('cancelada')
    || status.includes('returned')
    || status.includes('devuelta');

  return !canceledOrReturned || row.hasSalesDocument;
}

export function isAcceptedSalesDocument(row: SalesDocumentStatusRow) {
  return row.hasSalesDocument && row.salesDocumentStatus.trim().toUpperCase() === 'ACEPTADO';
}

export function needsSalesDocumentReview(row: SalesDocumentStatusRow) {
  return row.hasSalesDocument && row.salesDocumentStatus.trim().toUpperCase() !== 'ACEPTADO';
}

export function summarizeIssuedSalesDocuments(rows: SalesDocumentRow[]) {
  return rows.reduce(
    (summary, row) => {
      if (!isAcceptedSalesDocument(row) || !row.salesDocumentKind) return summary;

      const issued = row.salesDocumentKind === 'FACTURA' ? summary.facturas : summary.boletas;
      issued.count += 1;
      issued.amount += row.salesDocumentAmount;
      return summary;
    },
    {
      boletas: { count: 0, amount: 0 },
      facturas: { count: 0, amount: 0 },
    },
  );
}
