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
  // Get ALL non-accepted boletas
  const allBoletas = db.select().from(boletas)
    .where(inArray(boletas.estadoSunat, ['ENVIADO', 'PENDIENTE', 'RECHAZADO', 'ERROR', 'ENVIANDO']))
    .all();

  console.log(`📋 ${allBoletas.length} boletas no-aceptadas en BD local\n`);

  // Group by summary
  const bySummary = {};
  const withoutSummary = [];

  for (const b of allBoletas) {
    if (b.dailySummaryId) {
      if (!bySummary[b.dailySummaryId]) bySummary[b.dailySummaryId] = [];
      bySummary[b.dailySummaryId].push(b);
    } else {
      withoutSummary.push(b);
    }
  }

  const limboBoletas = [];

  // Check each summary against SUNAT
  const summaryIds = Object.keys(bySummary).map(Number);
  const summaries = db.select().from(dailySummaries)
    .where(inArray(dailySummaries.id, summaryIds))
    .all();

  const summaryMap = {};
  for (const s of summaries) summaryMap[s.id] = s;

  for (const [summaryIdStr, boletaGroup] of Object.entries(bySummary)) {
    const summaryId = Number(summaryIdStr);
    const summary = summaryMap[summaryId];
    if (!summary) continue;

    const company = db.select().from(companies).where(eq(companies.id, summary.companyId)).get();
    if (!company) continue;

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`📄 Resumen: ${summary.numeroCompleto} | Empresa: ${company.razonSocial}`);
    console.log(`   Estado local: ${summary.estado} | Ticket: ${summary.ticket || 'N/A'}`);
    console.log(`   Boletas en grupo: ${boletaGroup.length}`);

    let sunatEstado = 'DESCONOCIDO';
    let cdrCode = null;
    let cdrDesc = '';

    if (summary.ticket) {
      try {
        const statusResult = await querySunatStatus(company, summary.ticket);
        const interpreted = interpretStatus(statusResult);
        sunatEstado = interpreted.estado;
        cdrCode = interpreted.cdrCode;
        cdrDesc = interpreted.cdrDescription || statusResult.statusMessage || '';

        console.log(`   ☀️  SUNAT → ${sunatEstado}${cdrCode !== null ? ` (CDR ${cdrCode})` : ''}`);
        if (cdrDesc) console.log(`       ${cdrDesc}`);
      } catch (e) {
        sunatEstado = 'ERROR_CONSULTA';
        cdrDesc = e.message;
        console.log(`   ❌ Error: ${e.message}`);
      }
    } else {
      console.log(`   ⚠️  Sin ticket — no se puede consultar SUNAT`);
    }

    // Determine limbo status for each boleta
    for (const b of boletaGroup) {
      const client = b.clientId
        ? db.select().from(clients).where(eq(clients.id, b.clientId)).get()
        : null;

      let limboReason = '';
      let sunatBoletaEstado = sunatEstado;

      if (summary.ticket) {
        if (sunatEstado === 'ACEPTADO' && b.estadoSunat !== 'ACEPTADO') {
          limboReason = 'SUNAT aceptó pero local está como ' + b.estadoSunat;
        } else if (sunatEstado === 'RECHAZADO' && b.estadoSunat === 'ENVIADO') {
          limboReason = 'SUNAT rechazó (CDR ' + cdrCode + ') pero local está como ENVIADO';
        } else if (sunatEstado === 'EN_PROCESO') {
          limboReason = 'SUNAT aún procesando (code 98)';
        } else if (sunatEstado === 'ENVIADO') {
          limboReason = 'Sin CDR aún';
        }
      } else {
        if (b.estadoSunat === 'PENDIENTE') {
          limboReason = 'Nunca se envió a SUNAT';
        } else if (b.estadoSunat === 'RECHAZADO') {
          limboReason = 'Rechazado localmente, sin resumen para reconsultar';
        }
      }

      const isLimbo = limboReason !== '';

      console.log(`   ${isLimbo ? '⚠️' : '  '} ${b.numeroCompleto} | ${client?.razonSocial || 'N/A'} (${client?.numeroDocumento || ''}) | Local: ${b.estadoSunat} | SUNAT: ${sunatBoletaEstado}${limboReason ? ' → ' + limboReason : ''}`);

      if (isLimbo) {
        limboBoletas.push({
          numeroCompleto: b.numeroCompleto,
          orderNumber: b.orderNumber,
          company: company.razonSocial,
          ruc: company.ruc,
          cliente: client?.razonSocial || '',
          clienteDoc: client?.numeroDocumento || '',
          fechaEmision: b.fechaEmision,
          estadoLocal: b.estadoSunat,
          resumenNumero: summary.numeroCompleto,
          ticket: summary.ticket,
          estadoSunat: sunatBoletaEstado,
          cdrCode,
          cdrDescription: cdrDesc,
          limboReason,
        });
      }
    }
  }

  // Boletas without summary
  if (withoutSummary.length > 0) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`📄 Boletas SIN resumen asociado (${withoutSummary.length})`);

    const companyCache = {};

    for (const b of withoutSummary) {
      if (!companyCache[b.companyId]) {
        companyCache[b.companyId] = db.select().from(companies).where(eq(companies.id, b.companyId)).get();
      }
      const company = companyCache[b.companyId];
      const client = b.clientId
        ? db.select().from(clients).where(eq(clients.id, b.clientId)).get()
        : null;

      let limboReason = '';
      if (b.estadoSunat === 'PENDIENTE') limboReason = 'Nunca se envió a SUNAT';
      else if (b.estadoSunat === 'RECHAZADO') limboReason = 'Rechazado localmente';
      else if (b.estadoSunat === 'ENVIADO') limboReason = 'ENVIADO sin resumen — inconsistencia';

      console.log(`   ${limboReason ? '⚠️' : '  '} ${b.numeroCompleto} | ${company?.razonSocial || '?'} | ${client?.razonSocial || 'N/A'} | Local: ${b.estadoSunat}${limboReason ? ' → ' + limboReason : ''}`);

      if (limboReason) {
        limboBoletas.push({
          numeroCompleto: b.numeroCompleto,
          orderNumber: b.orderNumber,
          company: company?.razonSocial || '',
          ruc: company?.ruc || '',
          cliente: client?.razonSocial || '',
          clienteDoc: client?.numeroDocumento || '',
          fechaEmision: b.fechaEmision,
          estadoLocal: b.estadoSunat,
          resumenNumero: null,
          ticket: null,
          estadoSunat: 'NO_ENVIADO',
          cdrCode: null,
          cdrDescription: '',
          limboReason,
        });
      }
    }
  }

  // Final summary
  console.log(`\n\n${'█'.repeat(70)}`);
  console.log(`📊 TOTAL BOLETAS EN LIMBO: ${limboBoletas.length}`);
  console.log(`${'█'.repeat(70)}\n`);

  // Group by reason
  const byReason = {};
  for (const b of limboBoletas) {
    const key = b.limboReason;
    if (!byReason[key]) byReason[key] = [];
    byReason[key].push(b);
  }

  for (const [reason, boletas] of Object.entries(byReason)) {
    console.log(`\n${reason} (${boletas.length}):`);
    for (const b of boletas) {
      console.log(`   ${b.numeroCompleto} | ${b.company} | ${b.cliente} | ${b.fechaEmision}${b.resumenNumero ? ` | ${b.resumenNumero}` : ''}`);
    }
  }

  console.log(`\n${'█'.repeat(70)}`);
  console.log(JSON.stringify(limboBoletas, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('ERROR', error?.stack || error?.message || String(error));
    process.exit(1);
  });
