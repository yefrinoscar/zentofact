import { and, desc, eq, gte, like, lte, or } from 'drizzle-orm';
import { db } from '../db';
import { boletas, clients, creditNotes } from '../db/schema';

export interface CreditNoteFilter {
  companyId: number;
  branchId?: number;
  fechaDesde?: string;
  fechaHasta?: string;
  estado?: string;
  orderNumber?: string;
  limit?: number;
  offset?: number;
}

export async function listCreditNotes(filter: CreditNoteFilter) {
  const conditions = [eq(creditNotes.companyId, filter.companyId)];

  if (filter.branchId) {
    conditions.push(eq(creditNotes.branchId, filter.branchId));
  }
  if (filter.fechaDesde) {
    conditions.push(gte(creditNotes.fechaEmision, filter.fechaDesde));
  }
  if (filter.fechaHasta) {
    conditions.push(lte(creditNotes.fechaEmision, filter.fechaHasta));
  }
  if (filter.estado) {
    conditions.push(eq(creditNotes.estadoSunat, filter.estado));
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
    id: creditNotes.id,
    companyId: creditNotes.companyId,
    branchId: creditNotes.branchId,
    clientId: creditNotes.clientId,
    affectedBoletaId: creditNotes.affectedBoletaId,
    tipoDocumento: creditNotes.tipoDocumento,
    serie: creditNotes.serie,
    correlativo: creditNotes.correlativo,
    numeroCompleto: creditNotes.numeroCompleto,
    tipoDocAfectado: creditNotes.tipoDocAfectado,
    numDocAfectado: creditNotes.numDocAfectado,
    codMotivo: creditNotes.codMotivo,
    desMotivo: creditNotes.desMotivo,
    fechaEmision: creditNotes.fechaEmision,
    moneda: creditNotes.moneda,
    mtoImpVenta: creditNotes.mtoImpVenta,
    detalles: creditNotes.detalles,
    datosAdicionales: creditNotes.datosAdicionales,
    xmlPath: creditNotes.xmlPath,
    cdrPath: creditNotes.cdrPath,
    pdfPath: creditNotes.pdfPath,
    estadoSunat: creditNotes.estadoSunat,
    respuestaSunat: creditNotes.respuestaSunat,
    usuarioCreacion: creditNotes.usuarioCreacion,
    createdAt: creditNotes.createdAt,
    updatedAt: creditNotes.updatedAt,
    clientRazonSocial: clients.razonSocial,
    clientNumeroDocumento: clients.numeroDocumento,
    affectedBoletaNumeroCompleto: boletas.numeroCompleto,
    affectedBoletaFechaEmision: boletas.fechaEmision,
    affectedBoletaMtoImpVenta: boletas.mtoImpVenta,
    affectedBoletaEstadoSunat: boletas.estadoSunat,
    affectedOrderNumber: boletas.orderNumber,
  }).from(creditNotes)
    .innerJoin(clients, eq(clients.id, creditNotes.clientId))
    .leftJoin(boletas, eq(boletas.id, creditNotes.affectedBoletaId))
    .where(and(...conditions))
    .orderBy(desc(creditNotes.createdAt));

  const total = all.length;
  const paged = all.slice(offset, offset + limit);

  return { creditNotes: paged, total };
}
