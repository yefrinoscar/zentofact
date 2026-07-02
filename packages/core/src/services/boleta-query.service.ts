import { db } from '../db';
import { boletas, clients, creditNotes, dailySummaries } from '../db/schema';
import { eq, and, gte, lte, desc, like, or } from 'drizzle-orm';

export interface BoletaFilter {
  companyId: number;
  branchId?: number;
  fechaDesde?: string;
  fechaHasta?: string;
  summaryFechaDesde?: string;
  summaryFechaHasta?: string;
  matchFechaEmisionOrSummary?: boolean;
  estado?: string;
  orderNumber?: string;
  limit?: number;
  offset?: number;
}

export async function listBoletas(filter: BoletaFilter) {
  const conditions = [eq(boletas.companyId, filter.companyId)];

  if (filter.branchId) {
    conditions.push(eq(boletas.branchId, filter.branchId));
  }
  if (filter.matchFechaEmisionOrSummary && (filter.fechaDesde || filter.fechaHasta || filter.summaryFechaDesde || filter.summaryFechaHasta)) {
    const emissionConditions = [];
    const summaryConditions = [];
    if (filter.fechaDesde) emissionConditions.push(gte(boletas.fechaEmision, filter.fechaDesde));
    if (filter.fechaHasta) emissionConditions.push(lte(boletas.fechaEmision, filter.fechaHasta));
    if (filter.summaryFechaDesde) summaryConditions.push(gte(dailySummaries.fechaResumen, filter.summaryFechaDesde));
    if (filter.summaryFechaHasta) summaryConditions.push(lte(dailySummaries.fechaResumen, filter.summaryFechaHasta));
    const emissionClause = emissionConditions.length ? and(...emissionConditions) : undefined;
    const summaryClause = summaryConditions.length ? and(...summaryConditions) : undefined;
    if (emissionClause && summaryClause) {
      conditions.push(or(emissionClause, summaryClause)!);
    } else if (emissionClause) {
      conditions.push(emissionClause);
    } else if (summaryClause) {
      conditions.push(summaryClause);
    }
  } else {
    if (filter.fechaDesde) {
      conditions.push(gte(boletas.fechaEmision, filter.fechaDesde));
    }
    if (filter.fechaHasta) {
      conditions.push(lte(boletas.fechaEmision, filter.fechaHasta));
    }
    if (filter.summaryFechaDesde) {
      conditions.push(gte(dailySummaries.fechaResumen, filter.summaryFechaDesde));
    }
    if (filter.summaryFechaHasta) {
      conditions.push(lte(dailySummaries.fechaResumen, filter.summaryFechaHasta));
    }
  }
  if (filter.estado) {
    conditions.push(eq(boletas.estadoSunat, filter.estado));
  }
  if (filter.orderNumber) {
    conditions.push(or(
      like(boletas.orderNumber, `%${filter.orderNumber}%`),
      like(boletas.numeroCompleto, `%${filter.orderNumber}%`),
      like(creditNotes.numeroCompleto, `%${filter.orderNumber}%`),
    )!);
  }

  const limit = filter.limit ?? 20;
  const offset = filter.offset ?? 0;

  const all = await db.select({
    id: boletas.id,
    companyId: boletas.companyId,
    branchId: boletas.branchId,
    clientId: boletas.clientId,
    dailySummaryId: boletas.dailySummaryId,
    tipoDocumento: boletas.tipoDocumento,
    serie: boletas.serie,
    correlativo: boletas.correlativo,
    numeroCompleto: boletas.numeroCompleto,
    orderNumber: boletas.orderNumber,
    fechaEmision: boletas.fechaEmision,
    ublVersion: boletas.ublVersion,
    tipoOperacion: boletas.tipoOperacion,
    moneda: boletas.moneda,
    metodoEnvio: boletas.metodoEnvio,
    valorVenta: boletas.valorVenta,
    mtoOperGravadas: boletas.mtoOperGravadas,
    mtoOperExoneradas: boletas.mtoOperExoneradas,
    mtoOperInafectas: boletas.mtoOperInafectas,
    mtoOperGratuitas: boletas.mtoOperGratuitas,
    mtoIgvGratuitas: boletas.mtoIgvGratuitas,
    mtoIgv: boletas.mtoIgv,
    mtoBaseIvap: boletas.mtoBaseIvap,
    mtoIvap: boletas.mtoIvap,
    mtoIsc: boletas.mtoIsc,
    mtoIcbper: boletas.mtoIcbper,
    totalImpuestos: boletas.totalImpuestos,
    subTotal: boletas.subTotal,
    mtoImpVenta: boletas.mtoImpVenta,
    detalles: boletas.detalles,
    leyendas: boletas.leyendas,
    datosAdicionales: boletas.datosAdicionales,
    xmlPath: boletas.xmlPath,
    cdrPath: boletas.cdrPath,
    pdfPath: boletas.pdfPath,
    estadoSunat: boletas.estadoSunat,
    respuestaSunat: boletas.respuestaSunat,
    codigoHash: boletas.codigoHash,
    usuarioCreacion: boletas.usuarioCreacion,
    createdAt: boletas.createdAt,
    updatedAt: boletas.updatedAt,
    clientRazonSocial: clients.razonSocial,
    clientNumeroDocumento: clients.numeroDocumento,
    summaryId: dailySummaries.id,
    summaryNumeroCompleto: dailySummaries.numeroCompleto,
    summaryFechaResumen: dailySummaries.fechaResumen,
    summaryTicket: dailySummaries.ticket,
    summaryEstado: dailySummaries.estado,
    creditNoteId: creditNotes.id,
    creditNoteNumeroCompleto: creditNotes.numeroCompleto,
    creditNoteEstadoSunat: creditNotes.estadoSunat,
    creditNoteFechaEmision: creditNotes.fechaEmision,
  }).from(boletas)
    .innerJoin(clients, eq(clients.id, boletas.clientId))
    .leftJoin(dailySummaries, eq(dailySummaries.id, boletas.dailySummaryId))
    .leftJoin(creditNotes, eq(creditNotes.affectedBoletaId, boletas.id))
    .where(and(...conditions))
    .orderBy(desc(boletas.createdAt));

  const normalized = all.map(normalizeBoletaQueryRow);
  const total = normalized.length;
  const paged = normalized.slice(offset, offset + limit);

  return { boletas: paged, total };
}

function normalizeBoletaQueryRow(row: any) {
  if (isAcceptedByStoredSunatResponse(row)) {
    return { ...row, estadoSunat: 'ACEPTADO' };
  }
  return row;
}

function isAcceptedByStoredSunatResponse(row: any) {
  if (String(row.estadoSunat || '').toUpperCase() === 'ACEPTADO') return false;
  const response = String(row.respuestaSunat || '');
  if (!response) return false;
  if (response.includes('"code":"0"') || response.includes('"code": "0"')) return true;
  return /ha sido aceptad[oa]/i.test(response) && Boolean(row.cdrPath);
}
