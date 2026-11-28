import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decryptSecret,
  encryptSecret,
  generateApiKey,
  generateWebhookSecret,
  hashesEqual,
  parseApiKey,
  serverKeyEnv,
  sha256Hex,
  signWebhook,
  verifyWebhookSignature,
} from './crypto.js';
import { webhookBody, webhookHeaders, nextRetryDelaySeconds, RETRY_SCHEDULE_SECONDS } from './deliveries.js';

test('firma Standard Webhooks v1: vector conocido de la especificación', () => {
  // Vector público de standard-webhooks (mismo que usan las librerías oficiales).
  const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
  const signature = signWebhook(secret, {
    id: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
    timestamp: 1614265330,
    body: '{"test": 2432232314}',
  });
  assert.equal(signature, 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=');
});

test('verifica firmas en la lista separada por espacios (rotación)', () => {
  const secret = generateWebhookSecret();
  const other = generateWebhookSecret();
  const message = { id: 'evt_1', timestamp: 1700000000, body: '{"a":1}' };
  const good = signWebhook(secret, message);
  const bad = signWebhook(other, message);
  assert.equal(verifyWebhookSignature(secret, { ...message, header: `${bad} ${good}` }), true);
  assert.equal(verifyWebhookSignature(secret, { ...message, header: bad }), false);
  assert.equal(verifyWebhookSignature(secret, { ...message, body: '{"a":2}', header: good }), false);
  assert.throws(() => signWebhook('sin-prefijo', message), /whsec_/);
});

test('las cabeceras del webhook firman el cuerpo exacto que se envía', () => {
  const secret = generateWebhookSecret();
  const body = webhookBody({
    type: 'order.shipped',
    created_at: '2026-11-28T15:00:00.123Z',
    external_id: 'order_01',
    sequence: '42',
    payload: { orderNumber: 'L-DHZ2A7', carrier: 'shaloom', trackingNumber: 'T1', trackingUrl: null },
  });
  assert.deepEqual(JSON.parse(body), {
    type: 'order.shipped',
    timestamp: '2026-11-28T15:00:00Z',
    data: {
      externalId: 'order_01', orderNumber: 'L-DHZ2A7', carrier: 'shaloom',
      trackingNumber: 'T1', trackingUrl: null, sequence: 42,
    },
  });
  const headers = webhookHeaders({ secret, eventId: 'b5e0c9a6-0000-4000-8000-000000000001', body, now: 1_764_342_000_000 });
  assert.equal(headers['webhook-id'], 'b5e0c9a6-0000-4000-8000-000000000001');
  assert.equal(headers['webhook-timestamp'], '1764342000');
  assert.equal(verifyWebhookSignature(secret, {
    id: headers['webhook-id'], timestamp: headers['webhook-timestamp'], body, header: headers['webhook-signature'],
  }), true);
});

test('calendario de reintentos: 5s, 5m, 30m, 2h, 5h, 10h, 14h, 20h, 24h y luego falla', () => {
  assert.deepEqual(RETRY_SCHEDULE_SECONDS, [5, 300, 1800, 7200, 18000, 36000, 50400, 72000, 86400]);
  assert.equal(nextRetryDelaySeconds(1), 5);
  assert.equal(nextRetryDelaySeconds(9), 86400);
  assert.equal(nextRetryDelaySeconds(10), null);
});

test('la llave zf_<env>_<keyId>_<secret> se parsea sin ambigüedad y solo guarda el hash', () => {
  const key = generateApiKey('test');
  assert.match(key.token, /^zf_test_[a-z0-9]{16}_[a-z0-9]{64}$/);
  const parsed = parseApiKey(key.token);
  assert.equal(parsed.env, 'test');
  assert.equal(parsed.keyId, key.keyId);
  assert.equal(sha256Hex(parsed.secret), key.secretHash);
  assert.equal(parseApiKey('zf_prod_abcdefgh_' + 'a'.repeat(32)), null);
  assert.equal(parseApiKey('zf_live_ABC_x'), null);
  assert.equal(parseApiKey(''), null);
  assert.throws(() => generateApiKey('prod'), /inválido/);
});

test('comparación de hashes en tiempo constante', () => {
  const hash = sha256Hex('x');
  assert.equal(hashesEqual(hash, sha256Hex('x')), true);
  assert.equal(hashesEqual(hash, sha256Hex('y')), false);
  assert.equal(hashesEqual(hash, 'abc'), false);
});

test('producción solo acepta live; Railway manda sobre NODE_ENV', () => {
  assert.equal(serverKeyEnv({ NODE_ENV: 'production' }), 'live');
  assert.equal(serverKeyEnv({ NODE_ENV: 'development' }), 'test');
  assert.equal(serverKeyEnv({}), 'test');
  assert.equal(serverKeyEnv({ RAILWAY_ENVIRONMENT_NAME: 'production', NODE_ENV: 'development' }), 'live');
  assert.equal(serverKeyEnv({ RAILWAY_ENVIRONMENT_NAME: 'development', NODE_ENV: 'production' }), 'test');
});

test('el secreto del endpoint se cifra en reposo y falla cerrado sin clave', () => {
  const env = { INTEGRATION_ENCRYPTION_KEY: 'clave-de-prueba-suficientemente-larga' };
  const secret = generateWebhookSecret();
  const stored = encryptSecret(secret, env);
  assert.doesNotMatch(stored, /whsec_/);
  assert.equal(decryptSecret(stored, env), secret);
  assert.throws(() => decryptSecret(stored, { INTEGRATION_ENCRYPTION_KEY: 'otra-clave-distinta-muy-larga' }));
  assert.throws(() => encryptSecret(secret, {}), /INTEGRATION_ENCRYPTION_KEY/);
});
