import { eq } from 'drizzle-orm';
import { db } from '../db';
import { boletas, companies } from '../db/schema';
import { checkDailySummaryStatus } from './boleta.service';
import { saveCdr } from './file.service';
import { SunatService } from './sunat.service';

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

  const company = (await db.select().from(companies).where(eq(companies.id, boleta.companyId)).limit(1))[0];
  if (!company) return { boletaId, estadoSunat: boleta.estadoSunat, error: 'Empresa no encontrada.' };

  const sunat = new SunatService({
    ruc: company.ruc,
    razonSocial: company.razonSocial,
    direccion: company.direccion || '',
    ubigeo: company.ubigeo || '',
    usuarioSol: company.usuarioSol || '',
    claveSol: company.claveSol || '',
    certificado: company.certificado || '',
    certificadoPassword: company.certificadoPassword || '',
  });
  const result = await sunat.getStatusCdr(
    company.ruc,
    boleta.tipoDocumento || '03',
    boleta.serie,
    boleta.correlativo,
  );

  if (!result.success) {
    return {
      boletaId,
      estadoSunat: boleta.estadoSunat,
      success: false,
      error: result.error?.message || 'SUNAT no respondió la consulta.',
    };
  }

  const responseCode = String(result.cdrResponse?.code ?? '').trim();
  const responseText = String(result.cdrResponse?.description || result.statusMessage || '').trim();
  const notFound = result.statusCode === '0127' || /(?:ticket|comprobante).*(?:no existe|no encontrado)/i.test(responseText);
  const estadoSunat = responseCode === '0'
    ? 'ACEPTADO'
    : responseCode
      ? 'RECHAZADO'
      : notFound
        ? 'NO_ENVIADA'
        : String(boleta.estadoSunat || 'PENDIENTE').toUpperCase();
  const cdrPath = result.cdrZip ? await saveCdr(boleta, result.cdrZip) : boleta.cdrPath;
  const respuestaSunat = JSON.stringify({
    source: 'SUNAT_GET_STATUS_CDR',
    statusCode: result.statusCode || null,
    statusMessage: result.statusMessage || null,
    code: responseCode || null,
    description: responseText || null,
    checkedAt: new Date().toISOString(),
  });

  await db.update(boletas).set({
    estadoSunat,
    respuestaSunat,
    cdrPath,
    updatedAt: Math.floor(Date.now() / 1000),
  }).where(eq(boletas.id, boletaId));

  return {
    boletaId,
    estadoSunat,
    changed: estadoSunat !== String(boleta.estadoSunat || '').toUpperCase() || cdrPath !== boleta.cdrPath,
    success: true,
    message: responseText || result.statusMessage || 'Consulta completada.',
  };
}
