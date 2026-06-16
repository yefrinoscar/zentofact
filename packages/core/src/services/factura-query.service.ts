import { and, desc, eq, gte, like, lte, or } from 'drizzle-orm';
import { db } from '../db';
import { facturas } from '../db/schema';

export interface FacturaFilter {
  companyId: number;
  branchId?: number;
  fechaDesde?: string;
  fechaHasta?: string;
  estado?: string;
  orderNumber?: string;
  limit?: number;
  offset?: number;
}

export async function listFacturas(filter: FacturaFilter) {
  const conditions = [eq(facturas.companyId, filter.companyId)];

  if (filter.branchId) {
    conditions.push(eq(facturas.branchId, filter.branchId));
  }
  if (filter.fechaDesde) {
    conditions.push(gte(facturas.fechaEmision, filter.fechaDesde));
  }
  if (filter.fechaHasta) {
    conditions.push(lte(facturas.fechaEmision, filter.fechaHasta));
  }
  if (filter.estado) {
    conditions.push(eq(facturas.estado, filter.estado));
  }
  if (filter.orderNumber) {
    conditions.push(or(
      like(facturas.orderNumber, `%${filter.orderNumber}%`),
      like(facturas.numeroCompleto, `%${filter.orderNumber}%`),
    )!);
  }

  const limit = filter.limit ?? 20;
  const offset = filter.offset ?? 0;

  const all = await db.select({
    id: facturas.id,
    companyId: facturas.companyId,
    branchId: facturas.branchId,
    tipoDocumento: facturas.tipoDocumento,
    numeroCompleto: facturas.numeroCompleto,
    orderNumber: facturas.orderNumber,
    fechaEmision: facturas.fechaEmision,
    pdfPath: facturas.pdfPath,
    fuente: facturas.fuente,
    estado: facturas.estado,
    orderItemIds: facturas.orderItemIds,
    respuestaFalabella: facturas.respuestaFalabella,
    createdAt: facturas.createdAt,
    updatedAt: facturas.updatedAt,
  }).from(facturas)
    .where(and(...conditions))
    .orderBy(desc(facturas.createdAt));

  const total = all.length;
  const paged = all.slice(offset, offset + limit);

  return { facturas: paged, total };
}
