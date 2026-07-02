import { desc, eq, and, gte, lte } from 'drizzle-orm';
import { db, pool } from '../db';
import { boletas, clients, dailySummaries } from '../db/schema';
import { checkDailySummaryStatus } from './boleta.service';

export interface DailySummaryFilter {
  companyId?: number;
  fechaDesde?: string;
  fechaHasta?: string;
  estado?: string;
  limit?: number;
  offset?: number;
}

export async function listDailySummaries(filter: DailySummaryFilter) {
  const conditions = [];

  if (filter.companyId) {
    conditions.push(eq(dailySummaries.companyId, filter.companyId));
  }

  if (filter.fechaDesde) conditions.push(gte(dailySummaries.fechaResumen, filter.fechaDesde));
  if (filter.fechaHasta) conditions.push(lte(dailySummaries.fechaResumen, filter.fechaHasta));
  if (filter.estado) conditions.push(eq(dailySummaries.estado, filter.estado));

  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;
  const baseQuery = db.select().from(dailySummaries);
  const all = await (conditions.length
    ? baseQuery.where(and(...conditions))
    : baseQuery)
    .orderBy(desc(dailySummaries.createdAt));

  const summaries = await Promise.all(
    all.slice(offset, offset + limit).map(async summary => {
      const summaryBoletas = await listSummaryBoletas(summary);
      return { ...summary, boletas: summaryBoletas };
    })
  );

  return { summaries, total: all.length };
}

const VOID_SUMMARY_CREATOR_PREFIX = 'sistema:baja:';

const SUMMARY_BOLETAS_SELECT = `
  select
    b.id,
    b.numero_completo as "numeroCompleto",
    b.order_number as "orderNumber",
    b.fecha_emision as "fechaEmision",
    b.mto_imp_venta as total,
    b.estado_sunat as "estadoSunat",
    b.pdf_path as "pdfPath",
    c.razon_social as cliente,
    c.numero_documento as "clienteDocumento"
  from boletas b
  left join clients c on c.id = b.client_id
`;

async function listSummaryBoletas(summary: any) {
  if (String(summary.usuarioCreacion || '').startsWith(VOID_SUMMARY_CREATOR_PREFIX)) {
    const identifiers = new Set(Array.isArray(summary.orderNumbers) ? summary.orderNumbers.map((value: unknown) => String(value)) : []);
    const result = await pool.query(
      `${SUMMARY_BOLETAS_SELECT} where b.company_id = $1 order by b.created_at desc`,
      [summary.companyId],
    );

    return result.rows
      .filter((row: any) => identifiers.has(row.orderNumber || '') || identifiers.has(row.numeroCompleto))
      .map((row: any) => ({
        id: row.id,
        numeroCompleto: row.numeroCompleto,
        orderNumber: row.orderNumber,
        fechaEmision: row.fechaEmision,
        cliente: row.cliente || '',
        clienteDocumento: row.clienteDocumento || '',
        total: row.total,
        estadoSunat: row.estadoSunat,
        pdfPath: row.pdfPath,
      }));
  }

  const result = await pool.query(
    `${SUMMARY_BOLETAS_SELECT} where b.daily_summary_id = $1 order by b.created_at desc`,
    [summary.id],
  );

  return result.rows.map((row: any) => ({
    id: row.id,
    numeroCompleto: row.numeroCompleto,
    orderNumber: row.orderNumber,
    fechaEmision: row.fechaEmision,
    cliente: row.cliente || '',
    clienteDocumento: row.clienteDocumento || '',
    total: row.total,
    estadoSunat: row.estadoSunat,
    pdfPath: row.pdfPath,
  }));
}

export async function refreshDailySummaryStatus(id: number) {
  return checkDailySummaryStatus(id);
}

// Refresca el estado SUNAT de UNA boleta re-consultando el ticket de su resumen diario.
export async function refreshBoletaStatus(boletaId: number) {
  const rows = await db
    .select({ dailySummaryId: boletas.dailySummaryId, estadoSunat: boletas.estadoSunat })
    .from(boletas)
    .where(eq(boletas.id, boletaId))
    .limit(1);
  const boleta = rows[0];
  if (!boleta) return { error: 'Boleta no encontrada.' };
  if (boleta.dailySummaryId) {
    try { await checkDailySummaryStatus(boleta.dailySummaryId); } catch (e: any) {
      return { boletaId, estadoSunat: boleta.estadoSunat, error: e?.message || 'No se pudo consultar SUNAT.' };
    }
  }
  const updated = (await db
    .select({ estadoSunat: boletas.estadoSunat })
    .from(boletas)
    .where(eq(boletas.id, boletaId))
    .limit(1))[0];
  return { boletaId, dailySummaryId: boleta.dailySummaryId, estadoSunat: updated?.estadoSunat || boleta.estadoSunat };
}
