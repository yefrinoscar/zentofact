import assert from 'node:assert/strict';
import test from 'node:test';
import { providerFetch } from './provider-request.js';

test('cada request de sincronización tiene un timeout salvo que el caller pase una señal', async () => {
  const calls = [];
  const fetchImpl = async (_resource, init) => {
    calls.push(init);
    return { ok: true };
  };
  const request = providerFetch(fetchImpl, 1000);
  await request('https://example.com');
  const supplied = new AbortController().signal;
  await request('https://example.com', { signal: supplied });

  assert.equal(calls[0].signal instanceof AbortSignal, true);
  assert.equal(calls[1].signal, supplied);
});
