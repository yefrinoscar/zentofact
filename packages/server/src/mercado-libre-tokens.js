import { MercadoLibreApiClient, refreshAccessToken } from '@zentofact/mercado-libre-api';
import { mercadoLibreAppConfig } from './mercado-libre-oauth.js';
import {
  isMercadoLibreSandboxToken,
  mercadoLibreSandboxEnabled,
  mercadoLibreSandboxFetch,
  SANDBOX_ACCESS_TOKEN,
} from './mercado-libre-sandbox.js';

const REFRESH_SKEW_MS = 2 * 60_000;
const refreshLocks = new Map();

function loadCore() {
  return import('@zentofact/core');
}

function text(value) {
  return String(value ?? '').trim();
}

export function mercadoLibreGrantFromCompany(company) {
  if (!company) return null;
  const refreshToken = text(company.mercadoLibreRefreshToken || company.mercado_libre_refresh_token);
  const userId = text(company.mercadoLibreUserId || company.mercado_libre_user_id);
  if (!refreshToken || !userId) return null;
  return {
    userId,
    siteId: text(company.mercadoLibreSiteId || company.mercado_libre_site_id) || 'MPE',
    accessToken: text(company.mercadoLibreAccessToken || company.mercado_libre_access_token),
    refreshToken,
    expiresAt: Number(company.mercadoLibreTokenExpiresAt || company.mercado_libre_token_expires_at || 0),
  };
}

export function mercadoLibreTokenNeedsRefresh(grant, now = Date.now()) {
  if (!grant?.accessToken) return true;
  const expiresAt = Number(grant.expiresAt || 0);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return true;
  return expiresAt <= now + REFRESH_SKEW_MS;
}

async function persistGrant(companyId, token, previous) {
  const core = await loadCore();
  return core.setMercadoLibreGrant(companyId, {
    userId: token.userId || previous.userId,
    siteId: previous.siteId,
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: Date.now() + (Number(token.expiresIn) || 10800) * 1000,
  });
}

export async function refreshMercadoLibreGrant(company, dependencies = {}) {
  const grant = mercadoLibreGrantFromCompany(company);
  if (!grant) throw new Error('Falta el grant de Mercado Libre.');
  const env = dependencies.env || process.env;
  if (isMercadoLibreSandboxToken(grant.refreshToken) || isMercadoLibreSandboxToken(grant.accessToken)) {
    if (!mercadoLibreSandboxEnabled(env)) {
      throw new Error('El grant sandbox de Mercado Libre requiere MERCADO_LIBRE_SANDBOX=true.');
    }
    return {
      ...grant,
      accessToken: grant.accessToken || SANDBOX_ACCESS_TOKEN,
    };
  }
  if (!mercadoLibreTokenNeedsRefresh(grant, dependencies.now?.() || Date.now()) && !dependencies.force) {
    return grant;
  }
  const app = dependencies.appConfig || mercadoLibreAppConfig();
  const token = await (dependencies.refreshAccessToken || refreshAccessToken)({
    appId: app.appId,
    clientSecret: app.clientSecret,
    refreshToken: grant.refreshToken,
    fetchImpl: dependencies.fetchImpl,
  });
  const publicCompany = await (dependencies.persistGrant || persistGrant)(Number(company.id), token, grant);
  return mercadoLibreGrantFromCompany({
    ...company,
    ...publicCompany,
    mercadoLibreAccessToken: token.accessToken,
    mercadoLibreRefreshToken: token.refreshToken,
    mercadoLibreTokenExpiresAt: Date.now() + (Number(token.expiresIn) || 10800) * 1000,
  });
}

export async function mercadoLibreClientForCompany(company, dependencies = {}) {
  const companyId = Number(company?.id);
  const run = async () => {
    const grant = await refreshMercadoLibreGrant(company, dependencies);
    if (dependencies.client) return dependencies.client;
    const sandbox = isMercadoLibreSandboxToken(grant.accessToken || grant.refreshToken);
    return new MercadoLibreApiClient({
      accessToken: grant.accessToken,
      siteId: grant.siteId,
      fetchImpl: dependencies.fetchImpl || (sandbox ? mercadoLibreSandboxFetch : undefined),
    });
  };
  if (dependencies.skipLock) return run();
  const pending = refreshLocks.get(companyId);
  if (pending) return pending;
  const task = run().finally(() => {
    if (refreshLocks.get(companyId) === task) refreshLocks.delete(companyId);
  });
  refreshLocks.set(companyId, task);
  return task;
}
