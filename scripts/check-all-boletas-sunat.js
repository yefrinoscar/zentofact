process.env.DATABASE_URL = process.env.DATABASE_URL || 'sqlite:packages/desktop/storage/boletas.db';
process.env.STORAGE_PATH = process.env.STORAGE_PATH || 'packages/desktop/storage';

const { db } = require('../packages/core/dist/db');
const { boletas, companies, clients } = require('../packages/core/dist/db/schema');
const { eq, inArray } = require('drizzle-orm');

const BILL_CONSULT_ENDPOINT = 'https://e-factura.sunat.gob.pe/ol-it-wsconscpegem/billConsultService';

function buildGetStatusEnvelope(ruc, usuarioSol, claveSol, rucComp, tipoComp, serieComp, numComp) {
  const now = new Date();
  const created = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const expires = new Date(now.getTime() + 10 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const username = usuarioSol.startsWith(ruc) ? usuarioSol : `${ruc}${usuarioSol}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
  <soapenv:Header>
    <wsse:Security>
      <wsu:Timestamp wsu:Id="TS-${created}">
        <wsu:Created>${created}</wsu:Created>
        <wsu:Expires>${expires}</wsu:Expires>
      </wsu:Timestamp>
      <wsse:UsernameToken wsu:Id="UT-${created}">
        <wsse:Username>${escapeXml(username)}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${escapeXml(claveSol)}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
    <ser:getStatus>
      <rucComprobante>${escapeXml(rucComp)}</rucComprobante>
      <tipoComprobante>${escapeXml(tipoComp)}</tipoComprobante>
      <serieComprobante>${escapeXml(serieComp)}</serieComprobante>
      <numeroComprobante>${escapeXml(numComp)}</numeroComprobante>
    </ser:getStatus>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function escapeXml(v) {
  return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function extractXmlValue(xml, tag) {
  const match = xml.match(new RegExp(`<([^>]+:)?${tag}[^>]*>([\\s\\S]*?)</([^>]+:)?${tag}>`, 'i'));
  return match ? match[2].trim() : undefined;
}

async function queryCpeStatus(ruc, usuarioSol, claveSol, tipoDoc, serie, correlativo) {
  const envelope = buildGetStatusEnvelope(ruc, usuarioSol, claveSol, ruc, tipoDoc, serie, correlativo);

  const response = await fetch(BILL_CONSULT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': 'urn:getStatus',
      'Accept': 'text/xml',
    },
    body: envelope,
    signal: AbortSignal.timeout(30000),
  });

  const text = await response.text();
  const faultCode = extractXmlValue(text, 'faultcode');
  const faultString = extractXmlValue(text, 'faultstring');
  if (faultString) {
    return { success: false, error: faultString, raw: text.slice(0, 300) };
  }

  const statusCode = extractXmlValue(text, 'statusCode');
  const statusMessage = extractXmlValue(text, 'statusMessage');

  // status codes: 0001 = ACEPTADO, 0002 = ANULADO, 0003 = AUTORIZADO, 0000 = NO EXISTE
  let estado = 'DESCONOCIDO';
  if (statusCode === '0001') estado = 'ACEPTADO';
  else if (statusCode === '0002') estado = 'ANULADO';
  else if (statusCode === '0003') estado = 'AUTORIZADO';
  else if (statusCode === '0000') estado = 'NO_EXISTE';
  else if (statusCode) estado = `CODIGO_${statusCode}`;

  return { success: true, statusCode, statusMessage, estado };
}

async function main() {
  // Get all non-accepted boletas
  const allBoletas = db.select().from(boletas)
    .where(inArray(boletas.estadoSunat, ['ENVIADO', 'PENDIENTE', 'RECHAZADO', 'ERROR', 'ENVIANDO']))
    .all();

  console.log(`📋 ${allBoletas.length} boletas no-aceptadas en BD local`);
  console.log(`🔍 Consultando cada una contra SUNAT PRODUCCIÓN (BillConsultService getStatus)\n`);

  // Group by company to cache credentials
  const companyCache = {};
  const limboBoletas = [];
  let checked = 0;
  let errors = 0;

  for (const b of allBoletas) {
    if (!companyCache[b.companyId]) {
      companyCache[b.companyId] = db.select().from(companies).where(eq(companies.id, b.companyId)).get();
    }
    const company = companyCache[b.companyId];
    if (!company || !company.usuarioSol || !company.claveSol) {
      console.log(`⚠️  ${b.numeroCompleto} — sin credenciales SOL`);
      continue;
    }

    const client = b.clientId
      ? db.select().from(clients).where(eq(clients.id, b.clientId)).get()
      : null;

    checked++;
    process.stdout.write(`  [${checked}/${allBoletas.length}] ${b.numeroCompleto} (${company.razonSocial})... `);

    try {
      const result = await queryCpeStatus(
        company.ruc, company.usuarioSol, company.claveSol,
        b.tipoDocumento || '03', b.serie, String(b.correlativo),
      );

      if (result.success) {
        const isLimbo = (
          (result.estado === 'ACEPTADO' && b.estadoSunat !== 'ACEPTADO') ||
          (result.estado === 'ANULADO' && b.estadoSunat !== 'ANULADO') ||
          (result.estado === 'NO_EXISTE' && b.estadoSunat !== 'RECHAZADO' && b.estadoSunat !== 'PENDIENTE') ||
          (result.estado === 'AUTORIZADO')
        );

        console.log(`SUNAT: ${result.estado} (local: ${b.estadoSunat})${isLimbo ? ' ⚠️ LIMBO' : ''}`);

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
            estadoSunat: result.estado,
            sunatStatusCode: result.statusCode,
            sunatStatusMessage: result.statusMessage,
            limboReason: result.estado === 'NO_EXISTE'
              ? 'No existe en SUNAT'
              : `SUNAT dice ${result.estado} pero local dice ${b.estadoSunat}`,
          });
        }
      } else {
        errors++;
        console.log(`❌ ${result.error}`);
      }
    } catch (e) {
      errors++;
      console.log(`❌ ${e.message}`);
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n\n${'█'.repeat(70)}`);
  console.log(`📊 RESULTADO FINAL`);
  console.log(`${'█'.repeat(70)}\n`);
  console.log(`   Boletas consultadas: ${checked}`);
  console.log(`   Errores de consulta: ${errors}`);
  console.log(`   Boletas en LIMBO:    ${limboBoletas.length}\n`);

  if (limboBoletas.length > 0) {
    // Group by limbo type
    const byType = {};
    for (const b of limboBoletas) {
      const key = `${b.estadoSunat} (local: ${b.estadoLocal})`;
      if (!byType[key]) byType[key] = [];
      byType[key].push(b);
    }

    for (const [type, boletas] of Object.entries(byType)) {
      console.log(`\n${type} (${boletas.length}):`);
      for (const b of boletas) {
        console.log(`   ${b.numeroCompleto} | ${b.company} | ${b.cliente} (${b.clienteDoc}) | ${b.fechaEmision}`);
      }
    }

    console.log(`\n${'█'.repeat(70)}`);
    console.log(JSON.stringify(limboBoletas, null, 2));
  } else {
    console.log(`✅ No hay discrepancias entre la BD local y SUNAT producción.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('ERROR', error?.stack || error?.message || String(error));
    process.exit(1);
  });
