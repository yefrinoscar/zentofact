export type CompanyDocumentStats = {
  companyId: number;
  boletas: number;
  boletasNotAccepted: number;
  boletasAmount: number;
  facturas: number;
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
  boletasNotAccepted: 0,
  boletasAmount: 0,
  facturas: 0,
  facturasNotAccepted: 0,
  facturasAmount: 0,
  creditNotes: 0,
  creditNotesNotAccepted: 0,
  creditNotesAmount: 0,
});

export function buildDocumentStatsFromRows(
  kind: DocumentStatsKind,
  rows: Array<{ companyId: number; mtoImpVenta?: string | number | null; estadoSunat?: string | null; estado?: string | null }>,
): DocumentStats {
  const byCompany = new Map<number, CompanyDocumentStats>();
  const countKey = kind === 'boletas' ? 'boletas' : kind === 'facturas' ? 'facturas' : 'creditNotes';
  const notAcceptedKey = kind === 'boletas' ? 'boletasNotAccepted' : kind === 'facturas' ? 'facturasNotAccepted' : 'creditNotesNotAccepted';
  const amountKey = kind === 'boletas' ? 'boletasAmount' : kind === 'facturas' ? 'facturasAmount' : 'creditNotesAmount';

  for (const row of rows) {
    const current = byCompany.get(row.companyId) || { companyId: row.companyId, ...emptyTotals() };
    const status = String(row.estadoSunat || row.estado || '').toUpperCase();
    current[countKey] += 1;
    if (!['ACEPTADO', 'ANULADO', 'REEMPLAZADO'].includes(status)) current[notAcceptedKey] += 1;
    if (status === 'ACEPTADO') current[amountKey] += Number(row.mtoImpVenta) || 0;
    byCompany.set(row.companyId, current);
  }

  const companyRows = [...byCompany.values()];
  const global = companyRows.reduce((totals, row) => {
    totals[countKey] += row[countKey];
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
  return Boolean(
    global
    && Array.isArray((stats as DocumentStats).byCompany)
    && Number.isFinite(Number(global[amountKey]))
    && Number.isFinite(Number(global[notAcceptedKey])),
  );
}
