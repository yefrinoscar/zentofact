export type InvoiceFlowBucket = 'ready_to_invoice' | 'has_document' | 'not_ready' | 'review';
export type InvoiceFlowFilter = InvoiceFlowBucket;

type FilterableInvoiceFlowRow = {
  bucket: InvoiceFlowBucket;
  hasDocument: boolean;
};

type DocumentAmountRow = FilterableInvoiceFlowRow & {
  total: number;
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
