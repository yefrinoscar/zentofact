import assert from 'node:assert/strict';
import test from 'node:test';
import { mercadoLibreGrantFromCompany, mercadoLibreTokenNeedsRefresh } from './mercado-libre-tokens.js';

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
