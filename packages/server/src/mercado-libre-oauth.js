import { createHmac, timingSafeEqual } from 'node:crypto';
import { authorizationUrl, exchangeAuthorizationCode, MercadoLibreApiClient } from '@zentofact/mercado-libre-api';
import { ensureMercadoLibreOrderAccount } from './order-adapters/mercadolibre.js';

const STATE_TTL_MS = 15 * 60_000;

function loadCore() {
  return import('@zentofact/core');
}

function text(value) {
  return String(value ?? '').trim();
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function mercadoLibreAppConfig(env = process.env) {
  const appId = text(env.MERCADO_LIBRE_APP_ID);
  const clientSecret = text(env.MERCADO_LIBRE_CLIENT_SECRET);
  const redirectUri = text(env.MERCADO_LIBRE_REDIRECT_URI)
    || (text(env.AUTH_BASE_URL) ? `${text(env.AUTH_BASE_URL).replace(/\/+$/, '')}/integrations/mercado-libre/callback` : '');
  return {
    configured: Boolean(appId && clientSecret && redirectUri),
    appId,
    clientSecret,
    redirectUri,
    authHost: text(env.MERCADO_LIBRE_AUTH_HOST) || undefined,
  };
}

function stateSecret(env = process.env) {
  return text(env.MERCADO_LIBRE_STATE_SECRET || env.BETTER_AUTH_SECRET || env.MERCADO_LIBRE_CLIENT_SECRET);
}

export function signMercadoLibreOAuthState(payload, env = process.env) {
  const secret = stateSecret(env);
  if (!secret) throw httpError('Falta el secreto para firmar el estado de Mercado Libre.', 500);
  const body = Buffer.from(JSON.stringify({
    companyId: Number(payload.companyId),
    actorId: text(payload.actorId) || null,
    exp: Number(payload.exp),
  })).toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyMercadoLibreOAuthState(state, env = process.env, now = Date.now()) {
  const raw = text(state);
  const secret = stateSecret(env);
  const [body, mac] = raw.split('.');
  if (!body || !mac || !secret) throw httpError('El estado de Mercado Libre es inválido.', 400);
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const left = Buffer.from(mac);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw httpError('El estado de Mercado Libre es inválido.', 400);
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw httpError('El estado de Mercado Libre es inválido.', 400);
  }
  if (!Number.isInteger(Number(payload.companyId)) || Number(payload.companyId) <= 0) {
    throw httpError('El estado de Mercado Libre es inválido.', 400);
  }
  if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) < now) {
    throw httpError('El estado de Mercado Libre expiró. Vuelve a conectar.', 400);
  }
  return {
    companyId: Number(payload.companyId),
    actorId: payload.actorId || null,
    exp: Number(payload.exp),
  };
}

export function mercadoLibreWebRedirect(query = {}, env = process.env) {
  const origin = text(env.WEB_ORIGINS).split(',')[0].trim()
    || 'http://127.0.0.1:3011';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, String(value));
  }
  const suffix = params.toString();
  return `${origin.replace(/\/+$/, '')}/#/companies${suffix ? `?${suffix}` : ''}`;
}

export async function startMercadoLibreConnect(companyIdInput, actor, env = process.env) {
  const companyId = Number(companyIdInput);
  if (!Number.isInteger(companyId) || companyId <= 0) throw httpError('Empresa inválida.');
  const app = mercadoLibreAppConfig(env);
  if (!app.configured) {
    throw httpError('Falta configurar MERCADO_LIBRE_APP_ID, MERCADO_LIBRE_CLIENT_SECRET y el redirect URI.', 503);
  }
  const core = await loadCore();
  const company = await core.getPublicCompany(companyId);
  if (!company || company.activo === false) throw httpError('Empresa no encontrada o inactiva.', 404);
  const state = signMercadoLibreOAuthState({
    companyId,
    actorId: actor?.id || actor?.userId || null,
    exp: Date.now() + STATE_TTL_MS,
  }, env);
  return authorizationUrl({
    appId: app.appId,
    redirectUri: app.redirectUri,
    authHost: app.authHost,
    state,
  });
}

export async function finishMercadoLibreConnect(query = {}, dependencies = {}) {
  const env = dependencies.env || process.env;
  try {
    const code = text(query.code);
    if (!code) throw httpError('Mercado Libre no devolvió el código de autorización.');
    const state = verifyMercadoLibreOAuthState(query.state, env, dependencies.now?.() || Date.now());
    const app = mercadoLibreAppConfig(env);
    if (!app.configured) throw httpError('Falta la aplicación de Mercado Libre.', 503);
    const token = await (dependencies.exchangeAuthorizationCode || exchangeAuthorizationCode)({
      appId: app.appId,
      clientSecret: app.clientSecret,
      code,
      redirectUri: app.redirectUri,
      fetchImpl: dependencies.fetchImpl,
    });
    const me = await (dependencies.getMe || (async (accessToken) => (
      new MercadoLibreApiClient({ accessToken, fetchImpl: dependencies.fetchImpl }).getMe()
    )))(token.accessToken);
    if (text(me?.userId) && text(me.userId) !== text(token.userId)) {
      throw httpError('Mercado Libre devolvió un user_id distinto al del token.');
    }
    const core = dependencies.core || await loadCore();
    const company = await core.getCompany(state.companyId);
    if (!company || company.activo === false) throw httpError('Empresa no encontrada o inactiva.', 404);
    const existing = await core.getCompanyByMercadoLibreUserId(token.userId);
    if (existing && Number(existing.id) !== Number(company.id)) {
      throw httpError('Esa cuenta de Mercado Libre ya está conectada a otra empresa.');
    }
    const siteId = text(me?.siteId)
      || (token.raw && typeof token.raw === 'object' ? text(token.raw.site_id) : '');
    await core.setMercadoLibreGrant(company.id, {
      userId: token.userId,
      siteId: siteId || company.mercadoLibreSiteId || 'MPE',
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: Date.now() + (Number(token.expiresIn) || 10800) * 1000,
    });
    const displayName = company.nombre || company.nombreComercial || company.razonSocial || `Mercado Libre ${token.userId}`;
    await (dependencies.ensureAccount || ensureMercadoLibreOrderAccount)(
      dependencies.db || core.pool,
      company.id,
      displayName,
      token.userId,
    );
    return mercadoLibreWebRedirect({ ml: 'connected' }, env);
  } catch (error) {
    return mercadoLibreWebRedirect({
      ml: 'error',
      message: String(error?.message || 'No se pudo conectar Mercado Libre.').slice(0, 180),
    }, env);
  }
}

export async function disconnectMercadoLibre(companyIdInput) {
  const companyId = Number(companyIdInput);
  if (!Number.isInteger(companyId) || companyId <= 0) throw httpError('Empresa inválida.');
  const core = await loadCore();
  return core.clearMercadoLibreGrant(companyId);
}
