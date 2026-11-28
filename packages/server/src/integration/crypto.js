import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

// ── Llaves de API: zf_<env>_<keyId>_<secret> ──
// keyId y secret solo usan [a-z0-9] para que el separador "_" no sea ambiguo.

export const API_KEY_ENVS = ['live', 'test'];
const KEY_ID_RE = /^[a-z0-9]{8,40}$/;
const SECRET_RE = /^[a-z0-9]{32,128}$/;

export function sha256Hex(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function generateApiKey(env) {
  if (!API_KEY_ENVS.includes(env)) throw new Error(`Entorno de llave inválido: ${env}`);
  const keyId = randomBytes(8).toString('hex');
  const secret = randomBytes(32).toString('hex');
  return {
    token: `zf_${env}_${keyId}_${secret}`,
    env,
    keyId,
    secretHash: sha256Hex(secret),
  };
}

export function parseApiKey(token) {
  const value = String(token || '').trim();
  const parts = value.split('_');
  if (parts.length !== 4 || parts[0] !== 'zf') return null;
  const [, env, keyId, secret] = parts;
  if (!API_KEY_ENVS.includes(env) || !KEY_ID_RE.test(keyId) || !SECRET_RE.test(secret)) return null;
  return { env, keyId, secret };
}

// Compara en tiempo constante dos hashes hex de igual longitud.
export function hashesEqual(expectedHex, actualHex) {
  const expected = Buffer.from(String(expectedHex || ''), 'hex');
  const actual = Buffer.from(String(actualHex || ''), 'hex');
  if (expected.length !== 32 || actual.length !== 32) {
    // Igual se compara algo para no filtrar por tiempo cuál lado falló.
    timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return false;
  }
  return timingSafeEqual(expected, actual);
}

// ── Entorno del servidor: producción solo acepta llaves live ──
export function serverKeyEnv(env = process.env) {
  const railway = String(env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT || '').trim().toLowerCase();
  if (railway) return railway === 'production' ? 'live' : 'test';
  return String(env.NODE_ENV || '').trim().toLowerCase() === 'production' ? 'live' : 'test';
}

// ── Secretos de webhook (Standard Webhooks v1) ──

export function generateWebhookSecret() {
  return `whsec_${randomBytes(32).toString('base64')}`;
}

export function webhookSecretKey(secret) {
  const value = String(secret || '');
  if (!value.startsWith('whsec_')) throw new Error('El secreto del webhook debe empezar con whsec_.');
  const key = Buffer.from(value.slice('whsec_'.length), 'base64');
  if (!key.length) throw new Error('El secreto del webhook está vacío.');
  return key;
}

export function signWebhook(secret, { id, timestamp, body }) {
  const signature = createHmac('sha256', webhookSecretKey(secret))
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64');
  return `v1,${signature}`;
}

export function verifyWebhookSignature(secret, { id, timestamp, body, header }) {
  const expected = Buffer.from(signWebhook(secret, { id, timestamp, body }).slice(3), 'base64');
  return String(header || '').split(' ').some((entry) => {
    const [version, signature] = entry.split(',');
    if (version !== 'v1' || !signature) return false;
    const received = Buffer.from(signature, 'base64');
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
}

// ── Cifrado en reposo del secreto del endpoint (AES-256-GCM) ──
// Clave: INTEGRATION_ENCRYPTION_KEY o, en su defecto, BETTER_AUTH_SECRET.
// Sin ninguna de las dos no se guarda ni se lee nada (fail-closed).

function encryptionKey(env = process.env) {
  const material = String(env.INTEGRATION_ENCRYPTION_KEY || env.BETTER_AUTH_SECRET || '').trim();
  if (material.length < 16) {
    throw new Error('Falta INTEGRATION_ENCRYPTION_KEY (o BETTER_AUTH_SECRET) para cifrar secretos de integración.');
  }
  return createHash('sha256').update(`zentofact-integration:${material}`).digest();
}

export function encryptSecret(plain, env = process.env) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(env), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptSecret(stored, env = process.env) {
  const [version, iv, tag, ciphertext] = String(stored || '').split(':');
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Secreto cifrado inválido.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(env), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

export function stableHash(value) {
  return sha256Hex(stableJson(value));
}
