type QueryTarget = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type FalabellaLabelPrint = {
  labelIndex: number;
  printCount: number;
  firstPrintedAt: string;
  lastPrintedAt: string;
};

function isoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

export async function recordFalabellaLabelPrint(
  companyId: number,
  orderId: string,
  labelCount: number,
  target?: QueryTarget,
): Promise<FalabellaLabelPrint[]> {
  const safeLabelCount = Math.max(1, Math.floor(Number(labelCount) || 1));
  return recordFalabellaLabelPrintIndexes(
    companyId,
    orderId,
    Array.from({ length: safeLabelCount }, (_, index) => index + 1),
    target,
  );
}

export async function recordFalabellaLabelPrintIndexes(
  companyId: number,
  orderId: string,
  labelIndexes: number[],
  target?: QueryTarget,
): Promise<FalabellaLabelPrint[]> {
  const resolvedTarget = target || (await import('../db')).pool;
  const safeLabelIndexes = Array.from(new Set(
    labelIndexes
      .map(Number)
      .filter((value) => Number.isInteger(value) && value > 0),
  )).sort((left, right) => left - right);
  if (!safeLabelIndexes.length) throw new Error('Selecciona al menos una etiqueta para registrar.');
  const result = await resolvedTarget.query(
    `insert into falabella_label_prints (
       company_id, order_id, order_number, label_index,
       print_count, first_printed_at, last_printed_at
     )
     select fo.company_id, fo.order_id, fo.order_number, labels.label_index,
       1, now(), now()
     from falabella_orders fo
     cross join unnest($3::int[]) as labels(label_index)
     where fo.company_id=$1 and fo.order_id=$2
     on conflict (company_id, order_id, label_index) do update set
       order_number=excluded.order_number,
       print_count=falabella_label_prints.print_count + 1,
       last_printed_at=now()
     returning label_index, print_count, first_printed_at, last_printed_at`,
    [companyId, orderId, safeLabelIndexes],
  );
  if (!result.rows.length) throw new Error('No se pudo registrar la impresión porque el pedido no existe.');
  return result.rows.map((row) => ({
    labelIndex: Number(row.label_index),
    printCount: Number(row.print_count),
    firstPrintedAt: isoDate(row.first_printed_at),
    lastPrintedAt: isoDate(row.last_printed_at),
  })).sort((left, right) => left.labelIndex - right.labelIndex);
}
