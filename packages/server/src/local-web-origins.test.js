import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocalDevelopmentOrigin, localAuthOriginPatterns, localWebOrigins } from './local-web-origins.js';

test('autoriza las direcciones LAN del equipo únicamente durante desarrollo', () => {
  const interfaces = {
    lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    en0: [{ address: '192.168.68.58', family: 'IPv4', internal: false }],
  };

  assert.deepEqual(localWebOrigins({ interfaces, nodeEnv: 'development' }), [
    'http://192.168.68.58:3011',
    'http://192.168.68.58:3000',
  ]);
  assert.deepEqual(localWebOrigins({ interfaces, nodeEnv: 'production' }), []);
});

test('Better Auth acepta callbacks loopback en cualquier puerto solo durante desarrollo', () => {
  const patterns = localAuthOriginPatterns({ nodeEnv: 'development' });

  assert.ok(patterns.includes('http://localhost:*'));
  assert.ok(patterns.includes('http://127.0.0.1:*'));
  assert.ok(patterns.includes('http://[::1]:*'));
  assert.deepEqual(localAuthOriginPatterns({ nodeEnv: 'production' }), []);
});

test('reconoce únicamente orígenes web loopback durante desarrollo', () => {
  for (const origin of [
    'http://localhost:3012',
    'https://localhost:4173',
    'http://127.0.0.1:9876',
    'http://[::1]:3012',
  ]) {
    assert.equal(isLocalDevelopmentOrigin(origin, { nodeEnv: 'development' }), true);
    assert.equal(isLocalDevelopmentOrigin(origin, { nodeEnv: 'production' }), false);
  }

  assert.equal(isLocalDevelopmentOrigin('https://localhost.example:3012', { nodeEnv: 'development' }), false);
  assert.equal(isLocalDevelopmentOrigin('javascript:alert(1)', { nodeEnv: 'development' }), false);
});
