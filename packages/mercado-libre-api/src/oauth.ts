import type {
  AuthorizationUrlOptions,
  ExchangeCodeOptions,
  MercadoLibreToken,
  RefreshTokenOptions,
} from './types.js';
import {
  DEFAULT_API_BASE,
  DEFAULT_AUTH_HOST,
  DEFAULT_TOKEN_PATH,
  finiteNumber,
  nonEmptyText,
  objectRecord,
  providerError,
  readJson,
} from './http.js';

export function authorizationUrl(options: AuthorizationUrlOptions): string {
  const appId = nonEmptyText(options.appId);
  const redirectUri = nonEmptyText(options.redirectUri);
  if (!appId) throw new Error('Falta el APP ID de Mercado Libre.');
  if (!redirectUri) throw new Error('Falta el redirect URI de Mercado Libre.');
  const host = String(options.authHost || DEFAULT_AUTH_HOST).replace(/\/+$/, '');
  const url = new URL(`${host}/authorization`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', appId);
  url.searchParams.set('redirect_uri', redirectUri);
  if (options.state) url.searchParams.set('state', options.state);
  if (options.codeChallenge) {
    url.searchParams.set('code_challenge', options.codeChallenge);
    url.searchParams.set('code_challenge_method', options.codeChallengeMethod || 'S256');
  }
  return url.toString();
}

export async function exchangeAuthorizationCode(options: ExchangeCodeOptions): Promise<MercadoLibreToken> {
  return requestToken({
    grantType: 'authorization_code',
    appId: options.appId,
    clientSecret: options.clientSecret,
    code: options.code,
    redirectUri: options.redirectUri,
    codeVerifier: options.codeVerifier,
    fetchImpl: options.fetchImpl,
    tokenUrl: options.tokenUrl,
  });
}

export async function refreshAccessToken(options: RefreshTokenOptions): Promise<MercadoLibreToken> {
  return requestToken({
    grantType: 'refresh_token',
    appId: options.appId,
    clientSecret: options.clientSecret,
    refreshToken: options.refreshToken,
    fetchImpl: options.fetchImpl,
    tokenUrl: options.tokenUrl,
  });
}

async function requestToken(input: {
  grantType: 'authorization_code' | 'refresh_token';
  appId: string;
  clientSecret: string;
  code?: string;
  redirectUri?: string;
  codeVerifier?: string;
  refreshToken?: string;
  fetchImpl?: typeof fetch;
  tokenUrl?: string;
}): Promise<MercadoLibreToken> {
  const appId = nonEmptyText(input.appId);
  const secret = nonEmptyText(input.clientSecret);
  if (!appId || !secret) throw new Error('Faltan el APP ID o el secret de Mercado Libre.');
  const body = new URLSearchParams();
  body.set('grant_type', input.grantType);
  body.set('client_id', appId);
  body.set('client_secret', secret);
  if (input.grantType === 'authorization_code') {
    const code = nonEmptyText(input.code);
    const redirectUri = nonEmptyText(input.redirectUri);
    if (!code || !redirectUri) throw new Error('Faltan el code o el redirect URI de Mercado Libre.');
    body.set('code', code);
    body.set('redirect_uri', redirectUri);
    if (input.codeVerifier) body.set('code_verifier', input.codeVerifier);
  } else {
    const refreshToken = nonEmptyText(input.refreshToken);
    if (!refreshToken) throw new Error('Falta el refresh token de Mercado Libre.');
    body.set('refresh_token', refreshToken);
  }
  const fetchImpl = input.fetchImpl || fetch;
  const response = await fetchImpl(input.tokenUrl || `${DEFAULT_API_BASE}${DEFAULT_TOKEN_PATH}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const payload = await readJson(response);
  if (!response.ok) throw providerError(response.status, payload);
  return normalizeToken(payload);
}

export function normalizeToken(value: unknown): MercadoLibreToken {
  const record = objectRecord(value);
  const accessToken = nonEmptyText(record?.access_token);
  const refreshToken = nonEmptyText(record?.refresh_token);
  const userId = nonEmptyText(record?.user_id);
  if (!accessToken || !refreshToken || !userId) {
    throw new Error('Mercado Libre no devolvió access_token, refresh_token y user_id.');
  }
  return {
    accessToken,
    refreshToken,
    expiresIn: finiteNumber(record?.expires_in) || 10800,
    userId,
    scope: nonEmptyText(record?.scope),
    tokenType: nonEmptyText(record?.token_type) || 'bearer',
    raw: value,
  };
}
