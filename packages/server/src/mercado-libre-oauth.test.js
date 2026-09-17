import assert from 'node:assert/strict';
import test from 'node:test';
import {
  finishMercadoLibreConnect,
  mercadoLibreAppConfig,
  mercadoLibreWebRedirect,
  signMercadoLibreOAuthState,
  verifyMercadoLibreOAuthState,
} from './mercado-libre-oauth.js';

const env = {
  MERCADO_LIBRE_APP_ID: 'app-1',
  MERCADO_LIBRE_CLIENT_SECRET: 'secret-1',
  MERCADO_LIBRE_REDIRECT_URI: 'https://api.example/integrations/mercado-libre/callback',
  BETTER_AUTH_SECRET: 'state-secret',
  WEB_ORIGINS: 'http://127.0.0.1:3011',
};

test('firma y verifica el estado OAuth de una empresa', () => {
  const state = signMercadoLibreOAuthState({
    companyId: 4,
    actorId: 'user-1',
    exp: Date.now() + 60_000,
  }, env);
  const payload = verifyMercadoLibreOAuthState(state, env);
  assert.equal(payload.companyId, 4);
  assert.equal(payload.actorId, 'user-1');
});

test('rechaza un estado expirado o alterado', () => {
  const expired = signMercadoLibreOAuthState({ companyId: 4, exp: Date.now() - 10 }, env);
  assert.throws(() => verifyMercadoLibreOAuthState(expired, env), /expiró/);
  const valid = signMercadoLibreOAuthState({ companyId: 4, exp: Date.now() + 60_000 }, env);
  assert.throws(() => verifyMercadoLibreOAuthState(`${valid}x`, env), /inválido/);
});

test('rechaza un user_id que ya pertenece a otra empresa', async () => {
  const state = signMercadoLibreOAuthState({
    companyId: 4,
    exp: Date.now() + 60_000,
  }, env);
  const location = await finishMercadoLibreConnect({ code: 'auth-code', state }, {
    env,
    exchangeAuthorizationCode: async () => ({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresIn: 10800,
      userId: '999',
    }),
    getMe: async () => ({ userId: '999', siteId: 'MPE' }),
    core: {
      getCompany: async () => ({ id: 4, activo: true, nombre: 'LIMBO' }),
      getCompanyByMercadoLibreUserId: async () => ({ id: 7 }),
      setMercadoLibreGrant: async () => {
        throw new Error('no debía persistir el grant');
      },
    },
  });
  assert.match(location, /ml=error/);
  assert.match(decodeURIComponent(location.replace(/\+/g, ' ')), /ya est[aá] conectada/i);
});

test('arma el redirect de la app y detecta si falta la aplicación', () => {
  assert.equal(
    mercadoLibreWebRedirect({ ml: 'connected' }, env),
    'http://127.0.0.1:3011/#/companies?ml=connected',
  );
  assert.equal(
    mercadoLibreWebRedirect({ ml: 'connected', companyId: 4 }, env),
    'http://127.0.0.1:3011/#/companies?ml=connected&companyId=4',
  );
  assert.equal(mercadoLibreAppConfig(env).configured, true);
  assert.equal(mercadoLibreAppConfig({}).configured, false);
});

test('la aplicación guardada en la empresa tiene prioridad sobre el entorno', () => {
  const config = mercadoLibreAppConfig(env, {
    mercadoLibreAppId: 'company-app',
    mercadoLibreClientSecret: 'company-secret',
    mercadoLibreRedirectUri: 'https://company.example/callback',
  });
  assert.equal(config.appId, 'company-app');
  assert.equal(config.clientSecret, 'company-secret');
  assert.equal(config.redirectUri, 'https://company.example/callback');
});

test('no mezcla una aplicación incompleta de empresa con secretos del entorno', () => {
  const config = mercadoLibreAppConfig(env, { mercadoLibreAppId: 'company-app' });
  assert.equal(config.configured, false);
  assert.equal(config.clientSecret, '');
});

test('el callback intercambia el código con las credenciales de la empresa', async () => {
  const state = signMercadoLibreOAuthState({ companyId: 4, exp: Date.now() + 60_000 }, env);
  let exchangeInput;
  const location = await finishMercadoLibreConnect({ code: 'company-code', state }, {
    env,
    exchangeAuthorizationCode: async (input) => {
      exchangeInput = input;
      return {
        accessToken: 'access', refreshToken: 'refresh', expiresIn: 10800, userId: '999',
      };
    },
    getMe: async () => ({ userId: '999', siteId: 'MPE' }),
    ensureAccount: async () => {},
    core: {
      getCompany: async () => ({
        id: 4,
        activo: true,
        nombre: 'LIMBO',
        mercadoLibreAppId: 'company-app',
        mercadoLibreClientSecret: 'company-secret',
        mercadoLibreRedirectUri: 'https://company.example/callback',
      }),
      getCompanyByMercadoLibreUserId: async () => undefined,
      setMercadoLibreGrant: async () => {},
      pool: {},
    },
  });
  assert.match(location, /ml=connected/);
  assert.deepEqual(
    {
      appId: exchangeInput.appId,
      clientSecret: exchangeInput.clientSecret,
      redirectUri: exchangeInput.redirectUri,
    },
    {
      appId: 'company-app',
      clientSecret: 'company-secret',
      redirectUri: 'https://company.example/callback',
    },
  );
});
