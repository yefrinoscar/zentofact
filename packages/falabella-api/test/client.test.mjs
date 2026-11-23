import assert from 'node:assert/strict';
import test from 'node:test';

import { FalabellaApiClient, FalabellaApiError, signParameters } from '../dist/index.js';

test('SetStatusToReadyToShip sends signed parameters in the query string', async () => {
  let requestUrl = '';
  let requestInit;
  const apiKey = 'test-api-key';
  const controller = new AbortController();
  const client = new FalabellaApiClient({
    userId: 'seller@example.com',
    apiKey,
    version: '1.0',
    defaultFormat: 'JSON',
    fetchImpl: async (url, init) => {
      requestUrl = String(url);
      requestInit = init;
      return new Response(JSON.stringify({ SuccessResponse: { Body: {} } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await client.setStatusToReadyToShip({
    orderItemIds: ['123', '456'],
    packageId: 'PKG000123',
    signal: controller.signal,
  });

  const url = new URL(requestUrl);
  const signedParameters = Object.fromEntries(url.searchParams.entries());
  const signature = signedParameters.Signature;
  delete signedParameters.Signature;

  assert.equal(url.origin, 'https://sellercenter-api.falabella.com');
  assert.equal(url.pathname, '/');
  assert.equal(requestInit?.method, 'POST');
  assert.equal(requestInit?.body, undefined);
  assert.equal(requestInit?.signal, controller.signal);
  assert.equal(signedParameters.Action, 'SetStatusToReadyToShip');
  assert.equal(signedParameters.OrderItemIds, '[123,456]');
  assert.equal(signedParameters.PackageId, 'PKG000123');
  assert.equal(signature, signParameters(signedParameters, apiKey));
});

test('call raises a FalabellaApiError naming status, action and body when Falabella returns non-JSON', async () => {
  const client = new FalabellaApiClient({
    userId: 'seller@example.com',
    apiKey: 'k',
    fetchImpl: async () => new Response('upstream connect error or disconnect/reset before headers. reset reason: overflow', {
      status: 503,
      headers: { 'content-type': 'text/plain' },
    }),
  });

  await assert.rejects(
    client.call({ action: 'GetOrderItems', params: { OrderId: '1' } }),
    (error) => {
      assert.ok(error instanceof FalabellaApiError);
      assert.match(error.message, /Falabella respondió HTTP 503 sin JSON válido en GetOrderItems: upstream connect error/);
      assert.equal(error.details.source, 'falabella');
      assert.equal(error.details.kind, 'invalid_response');
      assert.equal(error.details.httpStatus, 503);
      assert.equal(error.details.action, 'GetOrderItems');
      assert.match(error.details.bodySnippet, /^upstream connect error/);
      return true;
    },
  );
});

test('call raises a network FalabellaApiError when Falabella is unreachable', async () => {
  const client = new FalabellaApiClient({
    userId: 'seller@example.com',
    apiKey: 'k',
    fetchImpl: async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
    },
  });

  await assert.rejects(
    client.call({ action: 'GetOrder', params: { OrderId: '1' } }),
    (error) => {
      assert.ok(error instanceof FalabellaApiError);
      assert.equal(error.details.kind, 'network');
      assert.match(error.message, /No se pudo conectar con Falabella \(GetOrder\): ECONNRESET/);
      return true;
    },
  );
});

test('call keeps abort and timeout errors untouched so callers can classify them', async () => {
  for (const name of ['AbortError', 'TimeoutError']) {
    const client = new FalabellaApiClient({
      userId: 'seller@example.com',
      apiKey: 'k',
      fetchImpl: async () => {
        throw new DOMException('stopped', name);
      },
    });
    await assert.rejects(
      client.call({ action: 'GetOrder', params: { OrderId: '1' } }),
      (error) => {
        assert.equal(error.name, name);
        assert.ok(!(error instanceof FalabellaApiError));
        return true;
      },
    );
  }
});
