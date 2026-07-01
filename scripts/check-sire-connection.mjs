#!/usr/bin/env node
import 'dotenv/config';

const DEFAULTS = {
  ruc: '20612600563',
  solUser: '71329360',
  codLibro: '140000',
};

const args = parseArgs(process.argv.slice(2));

const config = {
  clientId: args.clientId || process.env.SIRE_CLIENT_ID,
  clientSecret: args.clientSecret || process.env.SIRE_CLIENT_SECRET,
  ruc: args.ruc || process.env.SIRE_RUC || DEFAULTS.ruc,
  solUser: args.solUser || process.env.SIRE_SOL_USER || DEFAULTS.solUser,
  solPassword: args.solPassword || process.env.SIRE_SOL_PASSWORD,
  codLibro: args.codLibro || process.env.SIRE_COD_LIBRO || DEFAULTS.codLibro,
  showSecrets: Boolean(args.showSecrets || process.env.SIRE_SHOW_SECRETS === '1'),
};

const required = [
  ['SIRE_CLIENT_ID', config.clientId],
  ['SIRE_CLIENT_SECRET', config.clientSecret],
  ['SIRE_SOL_PASSWORD', config.solPassword],
];

const missing = required.filter(([, value]) => !value).map(([name]) => name);
if (missing.length) {
  console.error(`Faltan variables/argumentos: ${missing.join(', ')}`);
  console.error('');
  console.error('Ejemplo:');
  console.error('SIRE_CLIENT_ID="..." SIRE_CLIENT_SECRET="..." SIRE_SOL_PASSWORD="..." node scripts/check-sire-connection.mjs');
  process.exit(1);
}

const tokenUrl = `https://api-seguridad.sunat.gob.pe/v1/clientessol/${encodeURIComponent(config.clientId)}/oauth2/token/`;
const officialPeriodosUrl = `https://api-sire.sunat.gob.pe/v1/contribuyente/migeigv/libros/rvierce/padron/web/omisos/${encodeURIComponent(config.codLibro)}/periodos`;

main().catch((error) => {
  console.error('');
  console.error('ERROR:', error?.stack || error?.message || error);
  process.exitCode = 1;
});

async function main() {
  printDocs();

  const username = `${config.ruc}${config.solUser}`;
  const tokenBody = new URLSearchParams({
    grant_type: 'password',
    scope: 'https://api-sire.sunat.gob.pe',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    username,
    password: config.solPassword,
  });

  printRequest('TOKEN SIRE', {
    method: 'POST',
    url: tokenUrl,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: {
      grant_type: 'password',
      scope: 'https://api-sire.sunat.gob.pe',
      client_id: config.clientId,
      client_secret: secretValue(config.clientSecret),
      username,
      password: secretValue(config.solPassword),
    },
  });

  const tokenResponse = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: tokenBody,
  });

  const tokenText = await tokenResponse.text();
  const tokenJson = tryJson(tokenText);
  printResponse('TOKEN SIRE', tokenResponse, tokenJson, tokenText);

  const accessToken = tokenJson?.access_token;
  if (!accessToken) {
    console.log('');
    console.log('No hay access_token; no se prueban endpoints SIRE.');
    return;
  }

  printTokenClaims(accessToken);

  const tests = [
    {
      name: 'Periodos RVIE/RCE oficial del manual',
      url: officialPeriodosUrl,
      headers: jsonAuthHeaders(accessToken),
    },
    {
      name: 'Oficial + numRuc en query',
      url: `${officialPeriodosUrl}?numRuc=${encodeURIComponent(config.ruc)}`,
      headers: jsonAuthHeaders(accessToken),
    },
    {
      name: 'Oficial + numRuc en header',
      url: officialPeriodosUrl,
      headers: { ...jsonAuthHeaders(accessToken), numRuc: config.ruc },
    },
    {
      name: 'Variante diagnostica /rvie/',
      url: `https://api-sire.sunat.gob.pe/v1/contribuyente/migeigv/libros/rvie/padron/web/omisos/${encodeURIComponent(config.codLibro)}/periodos`,
      headers: jsonAuthHeaders(accessToken),
    },
  ];

  for (const test of tests) {
    printRequest(test.name, {
      method: 'GET',
      url: test.url,
      headers: redactHeaders(test.headers),
      body: '(No aplica)',
    });

    const response = await fetch(test.url, {
      method: 'GET',
      headers: test.headers,
    });
    const text = await response.text();
    const json = tryJson(text);
    printResponse(test.name, response, json, text);
  }
}

function printDocs() {
  console.log('Documentacion revisada:');
  console.log('- SIRE Ventas v29: https://cpe.sunat.gob.pe/sites/default/files/inline-files/Manual%20de%20servicios%20Web%20Api%20-%20SIRE_Ventas%20v29.pdf');
  console.log('- Pagina RVIE SUNAT: https://cpe.sunat.gob.pe/node/129');
  console.log('');
  console.log('Segun el manual:');
  console.log('- Token: POST api-seguridad.sunat.gob.pe/v1/clientessol/{client_id}/oauth2/token/');
  console.log('- Token body: x-www-form-urlencoded con grant_type, scope, client_id, client_secret, username={RUC}{USUARIO_SOL}, password.');
  console.log('- Periodos: GET api-sire.sunat.gob.pe/v1/contribuyente/migeigv/libros/rvierce/padron/web/omisos/{codLibro}/periodos');
  console.log('- Headers periodos: Authorization Bearer token, Accept application/json, Content-Type application/json.');
  console.log('');
}

function printRequest(title, request) {
  console.log(`\n=== REQUEST: ${title} ===`);
  console.log(`${request.method} ${request.url}`);
  for (const [key, value] of Object.entries(request.headers || {})) {
    console.log(`${key}: ${value}`);
  }
  if (request.body) {
    console.log('');
    if (typeof request.body === 'string') {
      console.log(request.body);
    } else {
      for (const [key, value] of Object.entries(request.body)) {
        console.log(`${key}=${value}`);
      }
    }
  }
}

function printResponse(title, response, json, text) {
  console.log(`\n=== RESPONSE: ${title} ===`);
  console.log(`HTTP ${response.status} ${response.statusText}`);
  console.log(`Content-Type: ${response.headers.get('content-type') || ''}`);
  const wwwAuthenticate = response.headers.get('www-authenticate');
  if (wwwAuthenticate) console.log(`WWW-Authenticate: ${wwwAuthenticate}`);

  if (json) {
    console.log(JSON.stringify(scrubJson(json), null, 2));
    return;
  }

  const preview = text ? text.replace(/\s+/g, ' ').trim().slice(0, 1200) : 'empty';
  console.log(preview);
}

function printTokenClaims(token) {
  const claims = decodeJwtPayload(token);
  console.log('\n=== TOKEN CLAIMS ===');
  if (!claims) {
    console.log('No se pudo decodificar como JWT.');
    return;
  }
  const safeClaims = scrubJson(claims);
  console.log(JSON.stringify(safeClaims, null, 2));
}

function jsonAuthHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

function redactHeaders(headers) {
  const redacted = { ...headers };
  if (redacted.Authorization) {
    redacted.Authorization = `Bearer <JWT len=${String(headers.Authorization).replace(/^Bearer\s+/i, '').length}>`;
  }
  if (redacted.authorization) {
    redacted.authorization = `Bearer <JWT len=${String(headers.authorization).replace(/^Bearer\s+/i, '').length}>`;
  }
  return redacted;
}

function scrubJson(value) {
  if (Array.isArray(value)) return value.map(scrubJson);
  if (!value || typeof value !== 'object') return value;

  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    if (/token|secret|password|clave/i.test(key)) {
      result[key] = '<redacted>';
    } else {
      result[key] = scrubJson(raw);
    }
  }
  return result;
}

function secretValue(value) {
  if (config.showSecrets) return value;
  return `<redacted len=${String(value || '').length}>`;
}

function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function decodeJwtPayload(token) {
  const parts = String(token).split('.');
  if (parts.length < 2) return null;
  const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  try {
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i++;
    }
  }
  return parsed;
}
