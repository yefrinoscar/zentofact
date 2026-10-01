import { eq } from 'drizzle-orm';
import { db } from '../db';
import { boletas } from '../db/schema';
import { checkDailySummaryStatus, refreshIndividualBoletaStatus } from './boleta.service';

// Refresca el estado SUNAT de una boleta mediante su resumen diario o,
// para emisiones individuales, consultando directamente su CDR en SUNAT.
export async function refreshBoletaStatus(boletaId: number) {
  const rows = await db
    .select()
    .from(boletas)
    .where(eq(boletas.id, boletaId))
    .limit(1);
  const boleta = rows[0];
  if (!boleta) return { error: 'Boleta no encontrada.' };

  if (boleta.dailySummaryId) {
    try { await checkDailySummaryStatus(boleta.dailySummaryId); } catch (e: any) {
      return { boletaId, estadoSunat: boleta.estadoSunat, error: e?.message || 'No se pudo consultar SUNAT.' };
    }
    const updated = (await db
      .select({ estadoSunat: boletas.estadoSunat })
      .from(boletas)
      .where(eq(boletas.id, boletaId))
      .limit(1))[0];
    return { boletaId, dailySummaryId: boleta.dailySummaryId, estadoSunat: updated?.estadoSunat || boleta.estadoSunat };
  }

  if (String(boleta.estadoSunat || '').toUpperCase() === 'ACEPTADO') {
    return { boletaId, estadoSunat: 'ACEPTADO', changed: false };
  }

  // Emisión individual: solo se marca ACEPTADO si el CDR corresponde a esta boleta.
  const refreshed = await refreshIndividualBoletaStatus(boletaId);
  return { boletaId, ...refreshed };
}
