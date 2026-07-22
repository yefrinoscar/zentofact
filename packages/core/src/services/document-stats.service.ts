import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import { boletas, companies, creditNotes, facturas } from '../db/schema';

export interface DocumentStatsFilter {
  fechaDesde?: string;
  fechaHasta?: string;
}

export interface CompanyDocumentStats {
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
}

export interface DocumentStats {
  global: Omit<CompanyDocumentStats, 'companyId'>;
  byCompany: CompanyDocumentStats[];
}

type DocumentTable = typeof boletas | typeof facturas | typeof creditNotes;
type CompanyAggregate = { count: number; notAccepted: number; amount: number };

async function aggregateByCompany(
  table: DocumentTable,
  filter: DocumentStatsFilter,
): Promise<Map<number, CompanyAggregate>> {
  const conditions = [eq(companies.activo, true)];
  if (filter.fechaDesde) conditions.push(gte(table.fechaEmision, filter.fechaDesde));
  if (filter.fechaHasta) conditions.push(lte(table.fechaEmision, filter.fechaHasta));

  const rows = await db
    .select({
      companyId: table.companyId,
      total: sql<number>`count(*)::int`,
      notAccepted: sql<number>`count(*) filter (
        where upper(coalesce(${table.estadoSunat}, '')) not in ('ACEPTADO', 'ANULADO', 'REEMPLAZADO')
      )::int`,
      amount: sql<string>`coalesce(sum(
        case
          when upper(coalesce(${table.estadoSunat}, '')) = 'ACEPTADO'
            and coalesce(${table.mtoImpVenta}, '') ~ '^-?[0-9]+([.][0-9]+)?$'
            then ${table.mtoImpVenta}::numeric
          else 0
        end
      ), 0)`,
    })
    .from(table)
    .innerJoin(companies, eq(companies.id, table.companyId))
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(table.companyId);

  const map = new Map<number, CompanyAggregate>();
  for (const row of rows) {
    map.set(Number(row.companyId), {
      count: Number(row.total) || 0,
      notAccepted: Number(row.notAccepted) || 0,
      amount: Number(row.amount) || 0,
    });
  }
  return map;
}

export async function getDocumentStats(filter: DocumentStatsFilter = {}): Promise<DocumentStats> {
  const [boletaMap, facturaMap, creditNoteMap] = await Promise.all([
    aggregateByCompany(boletas, filter),
    aggregateByCompany(facturas, filter),
    aggregateByCompany(creditNotes, filter),
  ]);

  const companyIds = new Set<number>([...boletaMap.keys(), ...facturaMap.keys(), ...creditNoteMap.keys()]);
  const byCompany: CompanyDocumentStats[] = [...companyIds]
    .sort((a, b) => a - b)
    .map((companyId) => ({
      companyId,
      boletas: boletaMap.get(companyId)?.count || 0,
      boletasNotAccepted: boletaMap.get(companyId)?.notAccepted || 0,
      boletasAmount: boletaMap.get(companyId)?.amount || 0,
      facturas: facturaMap.get(companyId)?.count || 0,
      facturasNotAccepted: facturaMap.get(companyId)?.notAccepted || 0,
      facturasAmount: facturaMap.get(companyId)?.amount || 0,
      creditNotes: creditNoteMap.get(companyId)?.count || 0,
      creditNotesNotAccepted: creditNoteMap.get(companyId)?.notAccepted || 0,
      creditNotesAmount: creditNoteMap.get(companyId)?.amount || 0,
    }));

  const global = byCompany.reduce(
    (acc, row) => {
      acc.boletas += row.boletas;
      acc.boletasNotAccepted += row.boletasNotAccepted;
      acc.boletasAmount += row.boletasAmount;
      acc.facturas += row.facturas;
      acc.facturasNotAccepted += row.facturasNotAccepted;
      acc.facturasAmount += row.facturasAmount;
      acc.creditNotes += row.creditNotes;
      acc.creditNotesNotAccepted += row.creditNotesNotAccepted;
      acc.creditNotesAmount += row.creditNotesAmount;
      return acc;
    },
    {
      boletas: 0,
      boletasNotAccepted: 0,
      boletasAmount: 0,
      facturas: 0,
      facturasNotAccepted: 0,
      facturasAmount: 0,
      creditNotes: 0,
      creditNotesNotAccepted: 0,
      creditNotesAmount: 0,
    },
  );

  return { global, byCompany };
}

/** Convenience for a single company (returns zeros if none). */
export async function getCompanyDocumentStats(
  companyId: number,
  filter: DocumentStatsFilter = {},
): Promise<CompanyDocumentStats> {
  const stats = await getDocumentStats(filter);
  return stats.byCompany.find((row) => row.companyId === companyId) || {
    companyId,
    boletas: 0,
    boletasNotAccepted: 0,
    boletasAmount: 0,
    facturas: 0,
    facturasNotAccepted: 0,
    facturasAmount: 0,
    creditNotes: 0,
    creditNotesNotAccepted: 0,
    creditNotesAmount: 0,
  };
}
