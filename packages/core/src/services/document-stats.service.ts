import { and, eq, gte, lte, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { boletas, companies, creditNotes, facturas } from '../db/schema';

export interface DocumentStatsFilter {
  fechaDesde?: string;
  fechaHasta?: string;
}

export interface CompanyDocumentStats {
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
}

export interface DocumentStats {
  global: Omit<CompanyDocumentStats, 'companyId'>;
  byCompany: CompanyDocumentStats[];
}

type DocumentTable = typeof boletas | typeof facturas | typeof creditNotes;
type CompanyAggregate = { count: number; rejected: number; withCreditNote: number; notAccepted: number; amount: number };

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
      accepted: sql<number>`count(*) filter (
        where upper(coalesce(${table.estadoSunat}, '')) = 'ACEPTADO'
      )::int`,
      rejected: sql<number>`count(*) filter (
        where upper(coalesce(${table.estadoSunat}, '')) in ('RECHAZADO', 'REEMPLAZADO')
      )::int`,
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
      rejected: Number(row.rejected) || 0,
      withCreditNote: 0,
      notAccepted: Number(row.notAccepted) || 0,
      amount: Number(row.amount) || 0,
    });
  }
  return map;
}

async function aggregateBoletasByCompany(filter: DocumentStatsFilter): Promise<Map<number, CompanyAggregate>> {
  const conditions = [eq(companies.activo, true)];
  if (filter.fechaDesde) conditions.push(gte(boletas.fechaEmision, filter.fechaDesde));
  if (filter.fechaHasta) conditions.push(lte(boletas.fechaEmision, filter.fechaHasta));

  const accepted = sql`(
    upper(coalesce(${boletas.estadoSunat}, '')) = 'ACEPTADO'
    or (
      upper(coalesce(${boletas.estadoSunat}, '')) = 'ANULADO'
      and upper(coalesce(${creditNotes.estadoSunat}, '')) = 'ACEPTADO'
    )
  )`;
  const rows = await db
    .select({
      companyId: boletas.companyId,
      total: sql<number>`count(*)::int`,
      accepted: sql<number>`count(*) filter (where ${accepted})::int`,
      rejected: sql<number>`count(*) filter (
        where upper(coalesce(${boletas.estadoSunat}, '')) in ('RECHAZADO', 'REEMPLAZADO')
      )::int`,
      withCreditNote: sql<number>`count(*) filter (
        where ${creditNotes.id} is not null
          and upper(coalesce(${creditNotes.estadoSunat}, '')) = 'ACEPTADO'
      )::int`,
      notAccepted: sql<number>`count(*) filter (
        where not ${accepted}
          and upper(coalesce(${boletas.estadoSunat}, '')) not in ('RECHAZADO', 'REEMPLAZADO')
      )::int`,
      amount: sql<string>`coalesce(sum(
        case
          when ${accepted}
            and coalesce(${boletas.mtoImpVenta}, '') ~ '^-?[0-9]+([.][0-9]+)?$'
            then ${boletas.mtoImpVenta}::numeric
          else 0
        end
      ), 0)`,
    })
    .from(boletas)
    .innerJoin(companies, eq(companies.id, boletas.companyId))
    .leftJoin(creditNotes, eq(creditNotes.affectedBoletaId, boletas.id))
    .where(and(...conditions))
    .groupBy(boletas.companyId);

  return new Map(rows.map((row) => [Number(row.companyId), {
    count: Number(row.total) || 0,
    rejected: Number(row.rejected) || 0,
    withCreditNote: Number(row.withCreditNote) || 0,
    notAccepted: Number(row.notAccepted) || 0,
    amount: Number(row.amount) || 0,
  }]));
}

async function aggregateFacturasByCompany(filter: DocumentStatsFilter): Promise<Map<number, CompanyAggregate>> {
  const conditions = [eq(companies.activo, true)];
  if (filter.fechaDesde) conditions.push(gte(facturas.fechaEmision, filter.fechaDesde));
  if (filter.fechaHasta) conditions.push(lte(facturas.fechaEmision, filter.fechaHasta));

  const accepted = sql`(
    upper(coalesce(${facturas.estadoSunat}, '')) = 'ACEPTADO'
    or (
      upper(coalesce(${facturas.estadoSunat}, '')) = 'ANULADO'
      and upper(coalesce(${creditNotes.estadoSunat}, '')) = 'ACEPTADO'
    )
  )`;
  const rows = await db
    .select({
      companyId: facturas.companyId,
      total: sql<number>`count(*)::int`,
      accepted: sql<number>`count(*) filter (where ${accepted})::int`,
      rejected: sql<number>`count(*) filter (
        where upper(coalesce(${facturas.estadoSunat}, '')) in ('RECHAZADO', 'REEMPLAZADO')
      )::int`,
      withCreditNote: sql<number>`count(*) filter (
        where ${creditNotes.id} is not null
          and upper(coalesce(${creditNotes.estadoSunat}, '')) = 'ACEPTADO'
      )::int`,
      notAccepted: sql<number>`count(*) filter (
        where not ${accepted}
          and upper(coalesce(${facturas.estadoSunat}, '')) not in ('RECHAZADO', 'REEMPLAZADO')
      )::int`,
      amount: sql<string>`coalesce(sum(
        case
          when ${accepted}
            and coalesce(${facturas.mtoImpVenta}, '') ~ '^-?[0-9]+([.][0-9]+)?$'
            then ${facturas.mtoImpVenta}::numeric
          else 0
        end
      ), 0)`,
    })
    .from(facturas)
    .innerJoin(companies, eq(companies.id, facturas.companyId))
    .leftJoin(creditNotes, or(
      eq(creditNotes.affectedFacturaId, facturas.id),
      and(
        eq(creditNotes.companyId, facturas.companyId),
        eq(creditNotes.tipoDocAfectado, '01'),
        eq(creditNotes.numDocAfectado, facturas.numeroCompleto),
      ),
    ))
    .where(and(...conditions))
    .groupBy(facturas.companyId);

  return new Map(rows.map((row) => [Number(row.companyId), {
    count: Number(row.total) || 0,
    rejected: Number(row.rejected) || 0,
    withCreditNote: Number(row.withCreditNote) || 0,
    notAccepted: Number(row.notAccepted) || 0,
    amount: Number(row.amount) || 0,
  }]));
}

export async function getDocumentStats(filter: DocumentStatsFilter = {}): Promise<DocumentStats> {
  const [boletaMap, facturaMap, creditNoteMap] = await Promise.all([
    aggregateBoletasByCompany(filter),
    aggregateFacturasByCompany(filter),
    aggregateByCompany(creditNotes, filter),
  ]);

  const companyIds = new Set<number>([...boletaMap.keys(), ...facturaMap.keys(), ...creditNoteMap.keys()]);
  const byCompany: CompanyDocumentStats[] = [...companyIds]
    .sort((a, b) => a - b)
    .map((companyId) => ({
      companyId,
      boletas: boletaMap.get(companyId)?.count || 0,
      boletasRejected: boletaMap.get(companyId)?.rejected || 0,
      boletasWithCreditNote: boletaMap.get(companyId)?.withCreditNote || 0,
      boletasNotAccepted: boletaMap.get(companyId)?.notAccepted || 0,
      boletasAmount: boletaMap.get(companyId)?.amount || 0,
      facturas: facturaMap.get(companyId)?.count || 0,
      facturasRejected: facturaMap.get(companyId)?.rejected || 0,
      facturasWithCreditNote: facturaMap.get(companyId)?.withCreditNote || 0,
      facturasNotAccepted: facturaMap.get(companyId)?.notAccepted || 0,
      facturasAmount: facturaMap.get(companyId)?.amount || 0,
      creditNotes: creditNoteMap.get(companyId)?.count || 0,
      creditNotesNotAccepted: creditNoteMap.get(companyId)?.notAccepted || 0,
      creditNotesAmount: creditNoteMap.get(companyId)?.amount || 0,
    }));

  const global = byCompany.reduce(
    (acc, row) => {
      acc.boletas += row.boletas;
      acc.boletasRejected += row.boletasRejected;
      acc.boletasWithCreditNote += row.boletasWithCreditNote;
      acc.boletasNotAccepted += row.boletasNotAccepted;
      acc.boletasAmount += row.boletasAmount;
      acc.facturas += row.facturas;
      acc.facturasRejected += row.facturasRejected;
      acc.facturasWithCreditNote += row.facturasWithCreditNote;
      acc.facturasNotAccepted += row.facturasNotAccepted;
      acc.facturasAmount += row.facturasAmount;
      acc.creditNotes += row.creditNotes;
      acc.creditNotesNotAccepted += row.creditNotesNotAccepted;
      acc.creditNotesAmount += row.creditNotesAmount;
      return acc;
    },
    {
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
  };
}
