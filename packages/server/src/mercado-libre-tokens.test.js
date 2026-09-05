import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mercadoLibreClientForCompany,
  mercadoLibreGrantFromCompany,
  mercadoLibreTokenNeedsRefresh,
  refreshMercadoLibreGrant,
} from './mercado-libre-tokens.js';
import { SANDBOX_ACCESS_TOKEN, SANDBOX_REFRESH_TOKEN, SANDBOX_SELLER_ID } from './mercado-libre-sandbox.js';

test('el grant existe solo cuando hay refresh token y user_id', () => {
  assert.equal(mercadoLibreGrantFromCompany({
    mercadoLibreUserId: '99',
    mercadoLibreRefreshToken: 'refresh',
  })?.userId, '99');
  assert.equal(mercadoLibreGrantFromCompany({
    mercadoLibreUserId: '99',
  }), null);
});

test('renueva el access token dos minutos antes del vencimiento', () => {
  const now = Date.parse('2026-09-05T12:00:00.000Z');
  assert.equal(mercadoLibreTokenNeedsRefresh({
    accessToken: 'tok',
    expiresAt: now + 60_000,
  }, now), true);
  assert.equal(mercadoLibreTokenNeedsRefresh({
    accessToken: 'tok',
    expiresAt: now + 5 * 60_000,
  }, now), false);
});

test('el grant sandbox no se refresca contra la API real', async () => {
  const company = {
    id: 1,
    mercadoLibreUserId: SANDBOX_SELLER_ID,
    mercadoLibreRefreshToken: SANDBOX_REFRESH_TOKEN,
    mercadoLibreAccessToken: SANDBOX_ACCESS_TOKEN,
  };
  await assert.rejects(
    () => refreshMercadoLibreGrant(company, { env: { MERCADO_LIBRE_SANDBOX: 'false' } }),
    /MERCADO_LIBRE_SANDBOX/,
  );
  const grant = await refreshMercadoLibreGrant(company, { env: { MERCADO_LIBRE_SANDBOX: 'true' } });
  assert.equal(grant.accessToken, SANDBOX_ACCESS_TOKEN);
  const client = await mercadoLibreClientForCompany(company, {
    env: { MERCADO_LIBRE_SANDBOX: 'true' },
    skipLock: true,
  });
  const me = await client.getMe();
  assert.equal(me.userId, SANDBOX_SELLER_ID);
});
