process.env.DATABASE_URL = process.env.DATABASE_URL || 'sqlite:packages/desktop/storage/boletas.db';
process.env.STORAGE_PATH = process.env.STORAGE_PATH || 'packages/desktop/storage';

const { SunatService } = require('../packages/core/dist/services/sunat.service');
const { db } = require('../packages/core/dist/db');
const { dailySummaries, companies, boletas, clients } = require('../packages/core/dist/db/schema');
const { eq, inArray, isNotNull } = require('drizzle-orm');

async function querySunatStatus(company, ticket) {
  const sunatService = new SunatService({
    ruc: company.ruc,
    razonSocial: company.razonSocial,
    direccion: company.direccion || '',
    ubigeo: company.ubigeo || '',
    usuarioSol: company.usuarioSol || 'MODDATOS',
    claveSol: company.claveSol || 'MODDATOS',
    certificado: company.certificado || '',
    certificadoPassword: company.certificadoPassword || '',
    modoProduccion: true,
  });
  return await sunatService.getStatus(ticket);
}

function interpretStatus(statusResult) {
  const statusCode = statusResult.statusCode || '';
  const normalizedCode = statusCode.replace(/^0+/, '') || statusCode;

  if (statusResult.cdrZip && statusResult.cdrResponse) {
    const cdrCode = statusResult.cdrResponse.code;
    return {
      estado: cdrCode === '0' ? 'ACEPTADO' : 'RECHAZADO',
      cdrCode,
      cdrDescription: statusResult.cdrResponse.description,
      hasCdr: true,
    };
  }

  if (normalizedCode === '98') {
    return { estado: 'EN_PROCESO', hasCdr: false };
  }

  if (statusCode) {
    return { estado: 'ENVIADO', statusCode, statusMessage: statusResult.statusMessage, hasCdr: false };
  }

  return { estado: 'SIN_RESPUESTA', hasCdr: false };
}

async function main() {
  const summaries = db.select().from(dailySummaries)
    .where(isNotNull(dailySummaries.ticket))
    .all();

  console.log(`🔍 Consultando ${summaries.length} resúmenes contra SUNAT PRODUCCIÓN...\n`);

  const limboResults = [];
  const allResults = [];

  for (const summary of summaries) {
    const company = db.select().from(companies).where(eq(companies.id, summary.companyId)).get();
    if (!company) continue;

    const linkedBoletas = db.select().from(boletas)
      .where(eq(boletas.dailySummaryId, summary.id))
      .all();

    console.log(`[${allResults.length + 1}/${summaries.length}] ${summary.numeroCompleto} (${company.razonSocial}) | Local: ${summary.estado} | Ticket: ${summary.ticket}`);

    try {
      const statusResult = await querySunatStatus(company, summary.ticket);
      const interpreted = interpretStatus(statusResult);

      const matchLocal = (
        (summary.estado === 'ACEPTADO' && interpreted.estado === 'ACEPTADO') ||
        (summary.estado === 'RECHAZADO' && interpreted.estado === 'RECHAZADO') ||
        (summary.estado === 'ERROR' && interpreted.hasCdr) ||
        (summary.estado === 'ENVIADO' && interpreted.estado === 'ENVIADO')
      );

      const isLimbo = !matchLocal || interpreted.estado === 'EN_PROCESO' || interpreted.estado === 'ENVIADO';

      allResults.push({
        summaryId: summary.id,
        numeroCompleto: summary.numeroCompleto,
        company: company.razonSocial,
        ruc: company.ruc,
        ticket: summary.ticket,
        fechaResumen: summary.fechaResumen,
        estadoLocal: summary.estado,
        estadoSunat: interpreted.estado,
        cdrCode: interpreted.cdrCode,
        cdrDescription: interpreted.cdrDescription || statusResult.statusMessage || '',
        boletaCount: linkedBoletas.length,
        matchLocal: matchLocal,
        error: statusResult.error?.message || null,
      });

      if (isLimbo) {
        limboResults.push(allResults[allResults.length - 1]);
        console.log(`   ⚠️  LIMBO → SUNAT: ${interpreted.estado}${interpreted.cdrCode ? ` (CDR ${interpreted.cdrCode})` : ''}`);
      } else {
        console.log(`   ✅ OK → SUNAT: ${interpreted.estado}${interpreted.cdrCode ? ` (CDR ${interpreted.cdrCode})` : ''}`);
      }
    } catch (e) {
      console.log(`   ❌ Error consulta: ${e.message}`);
      allResults.push({
        summaryId: summary.id,
        numeroCompleto: summary.numeroCompleto,
        company: company.razonSocial,
        ticket: summary.ticket,
        estadoLocal: summary.estado,
        estadoSunat: 'ERROR_CONSULTA',
        error: e.message,
        matchLocal: false,
      });
      limboResults.push(allResults[allResults.length - 1]);
    }
  }

  console.log(`\n\n${'═'.repeat(70)}`);
  console.log(`📊 RESUMEN: ${limboResults.length} de ${allResults.length} resúmenes están en LIMBO`);
  console.log(`${'═'.repeat(70)}\n`);

  if (limboResults.length === 0) {
    console.log('✅ Todos los resúmenes coinciden con SUNAT producción.');
    return;
  }

  const enProceso = limboResults.filter(r => r.estadoSunat === 'EN_PROCESO');
  const enviado = limboResults.filter(r => r.estadoSunat === 'ENVIADO');
  const rechazado = limboResults.filter(r => r.estadoSunat === 'RECHAZADO' && r.estadoLocal !== 'RECHAZADO');
  const aceptado = limboResults.filter(r => r.estadoSunat === 'ACEPTADO' && r.estadoLocal !== 'ACEPTADO');
  const errores = limboResults.filter(r => r.estadoSunat === 'ERROR_CONSULTA');

  if (enProceso.length) {
    console.log(`⏳ EN PROCESO (${enProceso.length}):`);
    for (const r of enProceso) {
      console.log(`   ${r.numeroCompleto} | ${r.company} | Ticket: ${r.ticket} | Local: ${r.estadoLocal}`);
    }
    console.log();
  }

  if (enviado.length) {
    console.log(`📤 ENVIADO / SIN CDR (${enviado.length}):`);
    for (const r of enviado) {
      console.log(`   ${r.numeroCompleto} | ${r.company} | Ticket: ${r.ticket} | Local: ${r.estadoLocal}`);
    }
    console.log();
  }

  if (rechazado.length) {
    console.log(`❌ RECHAZADO EN SUNAT (local: ${[...new Set(rechazado.map(r => r.estadoLocal))].join(', ')}) (${rechazado.length}):`);
    for (const r of rechazado) {
      console.log(`   ${r.numeroCompleto} | ${r.company} | CDR: ${r.cdrCode} - ${r.cdrDescription} | Local: ${r.estadoLocal}`);
    }
    console.log();
  }

  if (aceptado.length) {
    console.log(`✅ ACEPTADO EN SUNAT (local: ${[...new Set(aceptado.map(r => r.estadoLocal))].join(', ')}) (${aceptado.length}):`);
    for (const r of aceptado) {
      console.log(`   ${r.numeroCompleto} | ${r.company} | Local: ${r.estadoLocal}`);
    }
    console.log();
  }

  if (errores.length) {
    console.log(`🔴 ERROR DE CONSULTA (${errores.length}):`);
    for (const r of errores) {
      console.log(`   ${r.numeroCompleto} | ${r.company} | ${r.error}`);
    }
    console.log();
  }

  console.log(`${'═'.repeat(70)}`);
  console.log(JSON.stringify(limboResults, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('ERROR', error?.stack || error?.message || String(error));
    process.exit(1);
  });
