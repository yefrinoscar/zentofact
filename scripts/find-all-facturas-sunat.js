process.env.DATABASE_URL = process.env.DATABASE_URL || 'sqlite:packages/desktop/storage/boletas.db';
process.env.STORAGE_PATH = process.env.STORAGE_PATH || 'packages/desktop/storage';

const { db } = require('../packages/core/dist/db');
const { companies } = require('../packages/core/dist/db/schema');
const { eq } = require('drizzle-orm');

const BILL_CONSULT_ENDPOINT = 'https://e-factura.sunat.gob.pe/ol-it-wsconscpegem/billConsultService';

function buildGetStatusCdrEnvelope(ruc, usuarioSol, claveSol, rucComp, tipoComp, serieComp, numComp) {
  const now = new Date();
  const created = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const username = usuarioSol.startsWith(ruc) ? usuarioSol : `${ruc}${usuarioSol}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
  <soapenv:Header>
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>${escapeXml(username)}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${escapeXml(claveSol)}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
    <ser:getStatusCdr>
      <rucComprobante>${escapeXml(rucComp)}</rucComprobante>
      <tipoComprobante>${escapeXml(tipoComp)}</tipoComprobante>
      <serieComprobante>${escapeXml(serieComp)}</serieComprobante>
      <numeroComprobante>${escapeXml(numComp)}</numeroComprobante>
    </ser:getStatusCdr>
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

async function queryFacturaStatus(ruc, usuarioSol, claveSol, serie, correlativo) {
  const envelope = buildGetStatusCdrEnvelope(ruc, usuarioSol, claveSol, ruc, '01', serie, correlativo);

  const response = await fetch(BILL_CONSULT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': 'urn:getStatusCdr',
      'Accept': 'text/xml',
    },
    body: envelope,
    signal: AbortSignal.timeout(30000),
  });

  const text = await response.text();
  const faultCode = extractXmlValue(text, 'faultcode');
  const faultString = extractXmlValue(text, 'faultstring');
  if (faultString) {
    return { success: false, error: faultString };
  }

  const statusCode = extractXmlValue(text, 'statusCode');
  const statusMessage = extractXmlValue(text, 'statusMessage');
  const content = extractXmlValue(text, 'content');

  // 0001 = existe y aceptado, 0000 = no existe, 0002 = anulado
  let estado = 'DESCONOCIDO';
  if (statusCode === '0001') estado = 'ACEPTADO';
  else if (statusCode === '0000') estado = 'NO_EXISTE';
  else if (statusCode === '0002') estado = 'ANULADO';
  else if (statusCode === '0003') estado = 'AUTORIZADO';
  else if (statusCode) estado = `CODIGO_${statusCode}`;

  return { success: true, statusCode, statusMessage, estado, hasCdr: !!content };
}

async function scanSeries(ruc, usuarioSol, claveSol, series, maxCorrelativo) {
  const found = [];
  let lastFound = 0;
  let consecutiveNotFound = 0;
  const MAX_GAP = 50; // Si no encuentra 50 seguidas, para

  for (const serie of series) {
    console.log(`  Escaneando serie ${serie} (1-${maxCorrelativo})...`);
    lastFound = 0;
    consecutiveNotFound = 0;

    for (let i = 1; i <= maxCorrelativo; i++) {
      const padded = String(i).padStart(8, '0');
      const result = await queryFacturaStatus(ruc, usuarioSol, claveSol, serie, i);

      if (result.success && result.estado !== 'NO_EXISTE') {
        found.push({ serie, correlativo: i, numeroCompleto: `${serie}-${padded}`, estado: result.estado, hasCdr: result.hasCdr });
        console.log(`    ✅ ${serie}-${padded} → ${result.estado}${result.hasCdr ? ' (CDR disponible)' : ''}`);
        lastFound = i;
        consecutiveNotFound = 0;
      } else {
        consecutiveNotFound++;
      }

      if (consecutiveNotFound >= MAX_GAP && lastFound > 0) {
        console.log(`    ⏹️ ${MAX_GAP} consecutivas no encontradas después de ${serie}-${String(lastFound).padStart(8,'0')}, parando serie.`);
        break;
      }

      if (i % 20 === 0) {
        process.stdout.write(`    ...${serie}-${padded}\r`);
      }

      await new Promise(r => setTimeout(r, 150));
    }
    console.log('');
  }

  return found;
}

async function main() {
  const companies_list = db.select().from(companies).where(eq(companies.activo, true)).all();

  console.log(`🔍 Buscando FACTURAS en SUNAT PRODUCCIÓN para ${companies_list.length} empresas\n`);

  const allFacturas = [];

  for (const company of companies_list) {
    if (!company.usuarioSol || !company.claveSol) {
      console.log(`⚠️  ${company.razonSocial} (${company.ruc}) — sin credenciales SOL, saltando`);
      continue;
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🏢 ${company.razonSocial} (${company.ruc})`);
    console.log(`${'═'.repeat(60)}`);

    const facturas = await scanSeries(
      company.ruc, company.usuarioSol, company.claveSol,
      ['F001', 'F002', 'F003', 'FC01', 'FF01'],
      500,
    );

    for (const f of facturas) {
      f.company = company.razonSocial;
      f.ruc = company.ruc;
    }
    allFacturas.push(...facturas);

    console.log(`  📊 ${facturas.length} facturas encontradas para ${company.razonSocial}`);
  }

  console.log(`\n\n${'█'.repeat(60)}`);
  console.log(`📊 TOTAL FACTURAS ENCONTRADAS EN SUNAT: ${allFacturas.length}`);
  console.log(`${'█'.repeat(60)}\n`);

  if (allFacturas.length > 0) {
    for (const f of allFacturas) {
      console.log(`  ${f.numeroCompleto} | ${f.company} (${f.ruc}) | ${f.estado}${f.hasCdr ? ' [CDR]' : ''}`);
    }
    console.log(`\n${JSON.stringify(allFacturas, null, 2)}`);
  } else {
    console.log('No se encontraron facturas en SUNAT para ninguna empresa.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('ERROR', error?.stack || error?.message || String(error));
    process.exit(1);
  });
