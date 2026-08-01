import test from 'node:test';
import assert from 'node:assert/strict';
import { localWebOrigins } from './local-web-origins.js';

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
