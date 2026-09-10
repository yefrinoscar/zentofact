import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANONICAL_AUTH_ORIGIN_PATTERNS,
  CANONICAL_WEB_ORIGINS,
  allowCorsOrigin,
  configuredWebOrigins,
  isZentolabsOrigin,
  railwayServiceOrigins,
  resolveWebOrigins,
} from './web-origins.js';

test('el dominio canónico de LIMBO queda autorizado para CORS y Better Auth', () => {
  assert.deepEqual(CANONICAL_WEB_ORIGINS, [
    'https://limbo.zentoolabs.com',
    'https://limbo.zentolabs.com',
  ]);
  assert.deepEqual(CANONICAL_AUTH_ORIGIN_PATTERNS, [
    'https://*.zentoolabs.com',
    'https://*.zentolabs.com',
  ]);
  assert.equal(isZentolabsOrigin('https://limbo.zentoolabs.com'), true);
  assert.equal(isZentolabsOrigin('https://limbo.zentolabs.com'), true);
  assert.equal(isZentolabsOrigin('https://app.zentolabs.com'), true);
  assert.equal(isZentolabsOrigin('https://zentolabs.com'), true);
  assert.equal(isZentolabsOrigin('https://zentoolabs.com'), true);
  assert.equal(isZentolabsOrigin('http://limbo.zentoolabs.com'), false);
  assert.equal(isZentolabsOrigin('https://evilzentolabs.com'), false);
  assert.equal(isZentolabsOrigin('https://limbo.zentolabs.com.evil'), false);
  assert.equal(isZentolabsOrigin('https://limbo.zentoolabs.com.evil'), false);
});

test('WEB_ORIGINS y las URLs públicas de Railway se normalizan a orígenes', () => {
  const env = {
    WEB_ORIGINS: 'https://limbo.zentoolabs.com, https://zentofact-web-production.up.railway.app/',
    RAILWAY_PUBLIC_DOMAIN: 'zentofact-api-production.up.railway.app',
    RAILWAY_SERVICE_ZENTOFACT_WEB_URL: 'limbo.zentoolabs.com',
    RAILWAY_STATIC_URL: 'https://zentofact-web-production.up.railway.app',
    NODE_ENV: 'production',
  };

  assert.deepEqual(configuredWebOrigins(env), [
    'https://limbo.zentoolabs.com',
    'https://zentofact-web-production.up.railway.app/',
  ]);
  assert.deepEqual(railwayServiceOrigins(env), [
    'https://zentofact-api-production.up.railway.app',
    'https://limbo.zentoolabs.com',
    'https://zentofact-web-production.up.railway.app',
  ]);

  const origins = resolveWebOrigins({ env, localOrigins: [], localPatterns: [] });
  assert.ok(origins.includes('https://limbo.zentoolabs.com'));
  assert.ok(origins.includes('https://limbo.zentolabs.com'));
  assert.ok(origins.includes('https://zentofact-web-production.up.railway.app'));
  assert.ok(origins.includes('https://zentofact-api-production.up.railway.app'));
  assert.equal(origins.includes('https://*.zentolabs.com'), false);
  assert.equal(origins.includes('https://*.zentoolabs.com'), false);

  const authOrigins = resolveWebOrigins({
    env,
    includeAuthPatterns: true,
    localOrigins: [],
    localPatterns: [],
  });
  assert.ok(authOrigins.includes('https://*.zentoolabs.com'));
  assert.ok(authOrigins.includes('https://*.zentolabs.com'));
});

test('CORS acepta el dominio de LIMBO aunque no esté en la lista estática', () => {
  const webOrigins = ['https://zentofact-web-production.up.railway.app'];
  assert.equal(
    allowCorsOrigin('https://limbo.zentoolabs.com', webOrigins),
    'https://limbo.zentoolabs.com',
  );
  assert.equal(
    allowCorsOrigin('https://limbo.zentolabs.com', webOrigins),
    'https://limbo.zentolabs.com',
  );
  assert.equal(
    allowCorsOrigin('https://zentofact-web-production.up.railway.app/', webOrigins),
    'https://zentofact-web-production.up.railway.app',
  );
  assert.equal(allowCorsOrigin('https://evil.example', webOrigins), null);
  assert.equal(allowCorsOrigin('', webOrigins), null);
});
