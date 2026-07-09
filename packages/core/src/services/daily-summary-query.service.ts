import { eq } from 'drizzle-orm';
import { db } from '../db';
import { boletas } from '../db/schema';
import { checkDailySummaryStatus } from './boleta.service';

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
