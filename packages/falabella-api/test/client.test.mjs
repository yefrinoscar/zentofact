import assert from 'node:assert/strict';
import test from 'node:test';

import { FalabellaApiClient, signParameters } from '../dist/index.js';

test('SetStatusToReadyToShip sends signed parameters in the query string', async () => {
  let requestUrl = '';
  let requestInit;
  const apiKey = 'test-api-key';
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
  });

  const url = new URL(requestUrl);
  const signedParameters = Object.fromEntries(url.searchParams.entries());
  const signature = signedParameters.Signature;
  delete signedParameters.Signature;

  assert.equal(url.origin, 'https://sellercenter-api.falabella.com');
  assert.equal(url.pathname, '/');
  assert.equal(requestInit?.method, 'POST');
  assert.equal(requestInit?.body, undefined);
  assert.equal(signedParameters.Action, 'SetStatusToReadyToShip');
  assert.equal(signedParameters.OrderItemIds, '[123,456]');
  assert.equal(signedParameters.PackageId, 'PKG000123');
  assert.equal(signature, signParameters(signedParameters, apiKey));
});
