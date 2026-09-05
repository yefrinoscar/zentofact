import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import {
  authorizationUrl,
  extractOrderItemSellerSku,
  extractSellerSku,
  hourPrecision,
  MercadoLibreApiClient,
} from '../dist/index.js';

describe('oauth helpers', () => {
  it('builds the Peru authorization URL', () => {
    const url = authorizationUrl({
      appId: '123',
      redirectUri: 'https://app.example/cb',
      state: 'abc',
    });
    assert.equal(
      url,
      'https://auth.mercadolibre.com.pe/authorization?response_type=code&client_id=123&redirect_uri=https%3A%2F%2Fapp.example%2Fcb&state=abc',
    );
  });
});

describe('sku helpers', () => {
  it('reads SELLER_SKU and ignores seller_custom_field', () => {
    assert.equal(
      extractSellerSku({
        seller_custom_field: 'NOT-SKU',
        attributes: [{ id: 'SELLER_SKU', value_name: '  HOG025  ' }],
      }),
      'HOG025',
    );
    assert.equal(extractSellerSku({ seller_custom_field: 'NOT-SKU' }), null);
  });

  it('reads the order line seller_sku', () => {
    assert.equal(extractOrderItemSellerSku({ item: { seller_sku: 'HOG025' } }), 'HOG025');
    assert.equal(extractOrderItemSellerSku({ item: { seller_custom_field: 'x' } }), null);
  });
});

describe('hourPrecision', () => {
  it('truncates to the hour for search filters', () => {
    assert.equal(hourPrecision('2026-03-15T14:37:22.000Z'), '2026-03-15T14:00:00.000-00:00');
  });
});

describe('MercadoLibreApiClient', () => {
  it('sends Bearer tokens and the shipment format header', async () => {
    const fetchImpl = mock.fn(async () => new Response(JSON.stringify({ id: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const client = new MercadoLibreApiClient({
      accessToken: 'tok',
      fetchImpl,
    });
    await client.getMe();
    await client.getShipment('99');

    const firstCall = fetchImpl.mock.calls[0].arguments;
    const secondCall = fetchImpl.mock.calls[1].arguments;
    assert.equal(String(firstCall[0]), 'https://api.mercadolibre.com/users/me');
    assert.equal(String(secondCall[0]), 'https://api.mercadolibre.com/shipments/99');
    assert.equal(new Headers(firstCall[1].headers).get('authorization'), 'Bearer tok');
    assert.equal(new Headers(secondCall[1].headers).get('x-format-new'), 'true');
  });

  it('throws on HTTP failures', async () => {
    const client = new MercadoLibreApiClient({
      accessToken: 'tok',
      fetchImpl: async () =>
        new Response(JSON.stringify({ message: 'invalid_token', status: 401 }), { status: 401 }),
    });
    await assert.rejects(
      () => client.getMe(),
      (error) => error instanceof Error && /HTTP 401/.test(error.message),
    );
  });
});
