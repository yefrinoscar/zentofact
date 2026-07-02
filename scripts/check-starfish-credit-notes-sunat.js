const Database = require('better-sqlite3');

const DB_PATH = '/Users/ylaurach/Library/Application Support/@zentofact/desktop/storage/boletas.db';
const BILL_CONSULT_ENDPOINT = 'https://e-factura.sunat.gob.pe/ol-it-wsconscpegem/billConsultService';

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extractXmlValue(xml, tag) {
  const match = xml.match(new RegExp(`<([^>]+:)?${tag}[^>]*>([\\s\\S]*?)</([^>]+:)?${tag}>`, 'i'));
  return match ? match[2].trim() : undefined;
}

function envelope({ ruc, usuarioSol, claveSol, tipo, serie, numero }) {
  const now = new Date();
  const created = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const expires = new Date(now.getTime() + 10 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const username = String(usuarioSol || '').startsWith(ruc) ? usuarioSol : `${ruc}${usuarioSol}`;

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
      <rucComprobante>${escapeXml(ruc)}</rucComprobante>
      <tipoComprobante>${escapeXml(tipo)}</tipoComprobante>
      <serieComprobante>${escapeXml(serie)}</serieComprobante>
      <numeroComprobante>${escapeXml(numero)}</numeroComprobante>
    </ser:getStatus>
  </soapenv:Body>
</soapenv:Envelope>`;
}

async function query(company, serie, number) {
  const response = await fetch(BILL_CONSULT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: 'urn:getStatus',
      Accept: 'text/xml',
    },
    body: envelope({
      ruc: company.ruc,
      usuarioSol: company.usuario_sol,
      claveSol: company.clave_sol,
      tipo: '07',
      serie,
      numero: number,
    }),
    signal: AbortSignal.timeout(30000),
  });

  const text = await response.text();
  const fault = extractXmlValue(text, 'faultstring');
  if (fault) return { ok: false, error: fault };
  const statusCode = extractXmlValue(text, 'statusCode') || '';
  const statusMessage = extractXmlValue(text, 'statusMessage') || '';
  const estado = statusCode === '0001'
    ? 'ACEPTADO'
    : statusCode === '0002'
      ? 'ANULADO'
      : statusCode === '0003'
        ? 'AUTORIZADO'
        : statusCode === '0000'
          ? 'NO_EXISTE'
          : statusCode
            ? `CODIGO_${statusCode}`
            : 'SIN_CODIGO';
  return { ok: true, statusCode, statusMessage, estado };
}

async function main() {
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  const company = db.prepare('select * from companies where id = 5').get();
  db.close();

  const results = [];
  for (let n = 1; n <= 10; n += 1) {
    const numero = String(n).padStart(8, '0');
    const result = await query(company, 'B001', n);
    results.push({ numeroCompleto: `B001-${numero}`, ...result });
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  console.log(JSON.stringify({
    company: company.razon_social,
    ruc: company.ruc,
    tipo: '07',
    serie: 'B001',
    range: '00000001-00000010',
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
