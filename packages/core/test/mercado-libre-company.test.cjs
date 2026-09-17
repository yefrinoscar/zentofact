process.env.DATABASE_URL_POSTGRES ||= 'postgresql://zento:zento@127.0.0.1:5432/zentofact';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toPublicCompany } = require('../dist/services/company.service.js');

test('el DTO público de empresa no expone tokens de Mercado Libre', () => {
  const publicCompany = toPublicCompany({
    id: 4,
    ruc: '20990001001',
    razonSocial: 'LIMBO SAC',
    mercadoLibreUserId: '123456',
    mercadoLibreSiteId: 'MPE',
    mercadoLibreAccessToken: 'secret-access',
    mercadoLibreRefreshToken: 'secret-refresh',
    mercadoLibreTokenExpiresAt: Date.now() + 60_000,
  });
  assert.equal(publicCompany.mercadoLibreUserId, '123456');
  assert.equal(publicCompany.mercadoLibreSiteId, 'MPE');
  assert.equal(publicCompany.hasMercadoLibreCredentials, true);
  assert.equal('mercadoLibreAccessToken' in publicCompany, false);
  assert.equal('mercadoLibreRefreshToken' in publicCompany, false);
});
