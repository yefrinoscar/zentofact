import { and, desc, eq, gte, like, lte, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { facturas, clients, companies, branches } from '../db/schema';

export interface FacturaFilter {
  companyId: number;
  branchId?: number;
  serie?: string;
  fechaDesde?: string;
  fechaHasta?: string;
  estadoSunat?: string;
  orderNumber?: string;
  numeroCompleto?: string;
  limit?: number;
  offset?: number;
}

export async function listFacturas(filter: FacturaFilter) {
  const conditions = [eq(facturas.companyId, filter.companyId)];

  if (filter.branchId) {
    conditions.push(eq(facturas.branchId, filter.branchId));
  }
  if (filter.serie) {
    conditions.push(eq(facturas.serie, filter.serie));
  }
  if (filter.fechaDesde) {
    conditions.push(gte(facturas.fechaEmision, filter.fechaDesde));
  }
  if (filter.fechaHasta) {
    conditions.push(lte(facturas.fechaEmision, filter.fechaHasta));
  }
  if (filter.estadoSunat) {
    conditions.push(eq(facturas.estadoSunat, filter.estadoSunat));
  }
  if (filter.orderNumber) {
    conditions.push(like(facturas.orderNumber, `%${filter.orderNumber}%`));
  }
  if (filter.numeroCompleto) {
    conditions.push(like(facturas.numeroCompleto, `%${filter.numeroCompleto}%`));
  }

  const limit = filter.limit ?? 20;
  const offset = filter.offset ?? 0;

  const all = await db.select({
    id: facturas.id,
    companyId: facturas.companyId,
    branchId: facturas.branchId,
    clientId: facturas.clientId,
    tipoDocumento: facturas.tipoDocumento,
    serie: facturas.serie,
    correlativo: facturas.correlativo,
    numeroCompleto: facturas.numeroCompleto,
    orderNumber: facturas.orderNumber,
    fechaEmision: facturas.fechaEmision,
    ublVersion: facturas.ublVersion,
    tipoOperacion: facturas.tipoOperacion,
    moneda: facturas.moneda,
    metodoEnvio: facturas.metodoEnvio,
    mtoImpVenta: facturas.mtoImpVenta,
    mtoIgv: facturas.mtoIgv,
    mtoOperGravadas: facturas.mtoOperGravadas,
    xmlPath: facturas.xmlPath,
    cdrPath: facturas.cdrPath,
    pdfPath: facturas.pdfPath,
    estadoSunat: facturas.estadoSunat,
    codigoHash: facturas.codigoHash,
    detalles: facturas.detalles,
    fuente: facturas.fuente,
    orderItemIds: facturas.orderItemIds,
    respuestaFalabella: facturas.respuestaFalabella,
    createdAt: facturas.createdAt,
    updatedAt: facturas.updatedAt,
    clientRazonSocial: clients.razonSocial,
    clientNumeroDocumento: clients.numeroDocumento,
    clientTipoDocumento: clients.tipoDocumento,
  }).from(facturas)
    .leftJoin(clients, eq(facturas.clientId, clients.id))
    .where(and(...conditions))
    .orderBy(desc(facturas.createdAt));

  const total = all.length;
  const paged = all.slice(offset, offset + limit);

  return { facturas: paged, total };
}
