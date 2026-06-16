process.env.DATABASE_URL = process.env.DATABASE_URL || 'sqlite:packages/desktop/storage/boletas.db';
process.env.STORAGE_PATH = process.env.STORAGE_PATH || 'packages/desktop/storage';

const { SunatService } = require('../packages/core/dist/services/sunat.service');
const { db } = require('../packages/core/dist/db');
const { dailySummaries, companies, branches, boletas, clients } = require('../packages/core/dist/db/schema');
const { eq, inArray, isNotNull, isNull, or } = require('drizzle-orm');

const LIMBO_SUMMARY_STATES = ['ENVIADO', 'EN_PROCESO', 'ENVIANDO'];
const LIMBO_BOLETA_STATES = ['ENVIADO', 'ENVIANDO'];

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
  console.log('🔍 Buscando boletas en limbo (SUNAT PRODUCCIÓN)...\n');

  // 1. Resúmenes en limbo
  const limboSummaries = db.select().from(dailySummaries)
    .where(inArray(dailySummaries.estado, LIMBO_SUMMARY_STATES))
    .all();

  // 2. Boletas ENVIADO cuyo resumen no tiene CDR
  const boletasEnviado = db.select().from(boletas)
    .where(inArray(boletas.estadoSunat, LIMBO_BOLETA_STATES))
    .all();

  if (!limboSummaries.length && !boletasEnviado.length) {
    console.log('✅ No hay boletas ni resúmenes en limbo.');
    return;
  }

  console.log(`📋 ${limboSummaries.length} resumen(es) en limbo, ${boletasEnviado.length} boleta(s) ENVIADO\n`);

  const results = [];
  const processedSummaryIds = new Set();

  // Procesar resúmenes en limbo
  for (const summary of limboSummaries) {
    if (!summary.ticket) continue;

    const company = db.select().from(companies).where(eq(companies.id, summary.companyId)).get();
    if (!company) continue;

    const linkedBoletas = db.select().from(boletas)
      .where(eq(boletas.dailySummaryId, summary.id))
      .all();

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📄 Resumen #${summary.id} — ${summary.numeroCompleto}`);
    console.log(`   Empresa: ${company.razonSocial} (${company.ruc})`);
    console.log(`   Estado local: ${summary.estado} | Ticket: ${summary.ticket}`);
    console.log(`   Boletas: ${linkedBoletas.length}`);

    try {
      const statusResult = await querySunatStatus(company, summary.ticket);
      const interpreted = interpretStatus(statusResult);

      console.log(`   📡 SUNAT → ${interpreted.estado}`);
      if (interpreted.cdrCode !== undefined) {
        console.log(`      CDR: ${interpreted.cdrCode} - ${interpreted.cdrDescription || ''}`);
      }
      if (statusResult.error) {
        console.log(`      Error: ${statusResult.error.message}`);
      }

      results.push({
        tipo: 'resumen',
        summaryId: summary.id,
        numeroCompleto: summary.numeroCompleto,
        company: company.razonSocial,
        ruc: company.ruc,
        ticket: summary.ticket,
        estadoLocal: summary.estado,
        estadoSunat: interpreted.estado,
        cdrCode: interpreted.cdrCode,
        cdrDescription: interpreted.cdrDescription,
        boletaCount: linkedBoletas.length,
        error: statusResult.error?.message || null,
      });

      processedSummaryIds.add(summary.id);
    } catch (e) {
      console.log(`   ❌ Error: ${e.message}`);
      results.push({
        tipo: 'resumen',
        summaryId: summary.id,
        numeroCompleto: summary.numeroCompleto,
        company: company.razonSocial,
        ruc: company.ruc,
        ticket: summary.ticket,
        estadoLocal: summary.estado,
        estadoSunat: 'ERROR_CONSULTA',
        error: e.message,
      });
    }
  }

  // Procesar boletas ENVIADO cuyo resumen ya fue procesado o no tiene ticket
  for (const boleta of boletasEnviado) {
    if (boleta.dailySummaryId && processedSummaryIds.has(boleta.dailySummaryId)) continue;

    const company = db.select().from(companies).where(eq(companies.id, boleta.companyId)).get();
    if (!company) continue;

    const client = boleta.clientId
      ? db.select().from(clients).where(eq(clients.id, boleta.clientId)).get()
      : null;

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`🧾 Boleta ${boleta.numeroCompleto}`);
    console.log(`   Empresa: ${company.razonSocial} (${company.ruc})`);
    console.log(`   Cliente: ${client?.razonSocial || 'N/A'} (${client?.numeroDocumento || ''})`);
    console.log(`   Estado: ${boleta.estadoSunat}`);

    if (boleta.dailySummaryId) {
      const summary = db.select().from(dailySummaries).where(eq(dailySummaries.id, boleta.dailySummaryId)).get();
      if (summary?.ticket) {
        console.log(`   Resumen: ${summary.numeroCompleto} | Ticket: ${summary.ticket}`);

        try {
          const statusResult = await querySunatStatus(company, summary.ticket);
          const interpreted = interpretStatus(statusResult);

          console.log(`   📡 SUNAT → ${interpreted.estado}`);
          if (interpreted.cdrCode !== undefined) {
            console.log(`      CDR: ${interpreted.cdrCode} - ${interpreted.cdrDescription || ''}`);
          }

          results.push({
            tipo: 'boleta',
            boletaId: boleta.id,
            numeroCompleto: boleta.numeroCompleto,
            company: company.razonSocial,
            ruc: company.ruc,
            summaryId: summary.id,
            summaryNumero: summary.numeroCompleto,
            ticket: summary.ticket,
            estadoLocal: boleta.estadoSunat,
            estadoSunat: interpreted.estado,
            cdrCode: interpreted.cdrCode,
            cdrDescription: interpreted.cdrDescription,
            cliente: client?.razonSocial,
            error: statusResult.error?.message || null,
          });
        } catch (e) {
          console.log(`   ❌ Error: ${e.message}`);
          results.push({
            tipo: 'boleta',
            boletaId: boleta.id,
            numeroCompleto: boleta.numeroCompleto,
            company: company.razonSocial,
            estadoLocal: boleta.estadoSunat,
            estadoSunat: 'ERROR_CONSULTA',
            error: e.message,
          });
        }
      } else {
        console.log(`   ⚠️  Resumen sin ticket - no se puede consultar`);
        results.push({
          tipo: 'boleta',
          boletaId: boleta.id,
          numeroCompleto: boleta.numeroCompleto,
          company: company.razonSocial,
          estadoLocal: boleta.estadoSunat,
          estadoSunat: 'SIN_TICKET',
        });
      }
    } else {
      console.log(`   ⚠️  Sin resumen asociado`);
      results.push({
        tipo: 'boleta',
        boletaId: boleta.id,
        numeroCompleto: boleta.numeroCompleto,
        company: company.razonSocial,
        estadoLocal: boleta.estadoSunat,
        estadoSunat: 'SIN_RESUMEN',
      });
    }
  }

  // Resumen final
  console.log(`\n\n${'═'.repeat(60)}`);
  console.log('📊 RESUMEN FINAL');
  console.log(`${'═'.repeat(60)}\n`);

  const accepted = results.filter(r => r.estadoSunat === 'ACEPTADO');
  const rejected = results.filter(r => r.estadoSunat === 'RECHAZADO');
  const inProcess = results.filter(r => r.estadoSunat === 'EN_PROCESO');
  const stillSent = results.filter(r => r.estadoSunat === 'ENVIADO');
  const errors = results.filter(r => r.estadoSunat === 'ERROR_CONSULTA');
  const sinTicket = results.filter(r => r.estadoSunat === 'SIN_TICKET' || r.estadoSunat === 'SIN_RESUMEN');

  console.log(`   Aceptados:       ${accepted.length}`);
  console.log(`   Rechazados:      ${rejected.length}`);
  console.log(`   En proceso (98): ${inProcess.length}`);
  console.log(`   Sin CDR aún:     ${stillSent.length}`);
  console.log(`   Error consulta:  ${errors.length}`);
  console.log(`   Sin ticket:      ${sinTicket.length}`);

  if (accepted.length) {
    console.log('\n✅ Aceptados:');
    for (const r of accepted) {
      console.log(`   - ${r.numeroCompleto} (${r.company})`);
    }
  }

  if (rejected.length) {
    console.log('\n❌ Rechazados:');
    for (const r of rejected) {
      console.log(`   - ${r.numeroCompleto} (${r.company}): ${r.cdrDescription || r.error}`);
    }
  }

  if (inProcess.length) {
    console.log('\n⏳ En proceso (SUNAT code 98):');
    for (const r of inProcess) {
      console.log(`   - ${r.numeroCompleto} (${r.company})`);
    }
  }

  if (stillSent.length) {
    console.log('\n📤 Sin respuesta de CDR:');
    for (const r of stillSent) {
      console.log(`   - ${r.numeroCompleto} (${r.company})`);
    }
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(JSON.stringify(results, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('ERROR', error?.stack || error?.message || String(error));
    process.exit(1);
  });
