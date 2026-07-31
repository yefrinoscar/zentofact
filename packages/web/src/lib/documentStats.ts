export type CompanyDocumentStats = {
  companyId: number;
  boletas: number;
  boletasRejected: number;
  boletasWithCreditNote: number;
  boletasNotAccepted: number;
  boletasAmount: number;
  facturas: number;
  facturasRejected: number;
  facturasWithCreditNote: number;
  facturasNotAccepted: number;
  facturasAmount: number;
  creditNotes: number;
  creditNotesNotAccepted: number;
  creditNotesAmount: number;
};

export type DocumentStats = {
  global: Omit<CompanyDocumentStats, 'companyId'>;
  byCompany: CompanyDocumentStats[];
};

export type DocumentStatsKind = 'boletas' | 'facturas' | 'credit-notes';

const emptyTotals = () => ({
  boletas: 0,
  boletasRejected: 0,
  boletasWithCreditNote: 0,
  boletasNotAccepted: 0,
  boletasAmount: 0,
  facturas: 0,
  facturasRejected: 0,
  facturasWithCreditNote: 0,
  facturasNotAccepted: 0,
  facturasAmount: 0,
  creditNotes: 0,
  creditNotesNotAccepted: 0,
  creditNotesAmount: 0,
});

export function buildDocumentStatsFromRows(
  kind: DocumentStatsKind,
  rows: Array<{ companyId: number; mtoImpVenta?: string | number | null; estadoSunat?: string | null; estado?: string | null; creditNoteId?: number | null }>,
): DocumentStats {
  const byCompany = new Map<number, CompanyDocumentStats>();
  const countKey = kind === 'boletas' ? 'boletas' : kind === 'facturas' ? 'facturas' : 'creditNotes';
  const notAcceptedKey = kind === 'boletas' ? 'boletasNotAccepted' : kind === 'facturas' ? 'facturasNotAccepted' : 'creditNotesNotAccepted';
  const amountKey = kind === 'boletas' ? 'boletasAmount' : kind === 'facturas' ? 'facturasAmount' : 'creditNotesAmount';

  for (const row of rows) {
    const current = byCompany.get(row.companyId) || { companyId: row.companyId, ...emptyTotals() };
    const status = String(row.estadoSunat || row.estado || '').toUpperCase();
    current[countKey] += 1;
    if (kind === 'boletas' && ['RECHAZADO', 'REEMPLAZADO'].includes(status)) current.boletasRejected += 1;
    if (kind === 'facturas' && ['RECHAZADO', 'REEMPLAZADO'].includes(status)) current.facturasRejected += 1;
    if (kind === 'boletas' && row.creditNoteId) current.boletasWithCreditNote += 1;
    if (kind === 'facturas' && row.creditNoteId) current.facturasWithCreditNote += 1;
    if (!['ACEPTADO', 'ANULADO', 'REEMPLAZADO'].includes(status)) current[notAcceptedKey] += 1;
    if (status === 'ACEPTADO') current[amountKey] += Number(row.mtoImpVenta) || 0;
    byCompany.set(row.companyId, current);
  }

  const companyRows = [...byCompany.values()];
  const global = companyRows.reduce((totals, row) => {
    totals[countKey] += row[countKey];
    if (kind === 'boletas') totals.boletasRejected += row.boletasRejected;
    if (kind === 'facturas') totals.facturasRejected += row.facturasRejected;
    if (kind === 'boletas') totals.boletasWithCreditNote += row.boletasWithCreditNote;
    if (kind === 'facturas') totals.facturasWithCreditNote += row.facturasWithCreditNote;
    totals[notAcceptedKey] += row[notAcceptedKey];
    totals[amountKey] += row[amountKey];
    return totals;
  }, emptyTotals());

  return { global, byCompany: companyRows };
}

export function hasCompleteDocumentStats(stats: unknown, kind: DocumentStatsKind): stats is DocumentStats {
  const global = (stats as DocumentStats | null | undefined)?.global;
  const amountKey = kind === 'boletas' ? 'boletasAmount' : kind === 'facturas' ? 'facturasAmount' : 'creditNotesAmount';
  const notAcceptedKey = kind === 'boletas' ? 'boletasNotAccepted' : kind === 'facturas' ? 'facturasNotAccepted' : 'creditNotesNotAccepted';
  const salesStatsAreComplete = kind === 'boletas'
    ? Number.isFinite(Number(global?.boletasRejected)) && Number.isFinite(Number(global?.boletasWithCreditNote))
    : kind === 'facturas'
      ? Number.isFinite(Number(global?.facturasRejected)) && Number.isFinite(Number(global?.facturasWithCreditNote))
      : true;
  return Boolean(
    global
    && Array.isArray((stats as DocumentStats).byCompany)
    && Number.isFinite(Number(global[amountKey]))
    && Number.isFinite(Number(global[notAcceptedKey]))
    && salesStatsAreComplete,
  );
}
