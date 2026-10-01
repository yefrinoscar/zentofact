const assert = require('node:assert/strict');
const test = require('node:test');
const AdmZip = require('adm-zip');

const { SunatService, classifySunatSendResult } = require('../dist/services/sunat.service.js');

test('clasifica solo un CDR explícitamente aceptado como ACEPTADO', () => {
  assert.equal(classifySunatSendResult({ success: true, cdrResponse: { code: '0' } }), 'ACEPTADO');
  assert.equal(classifySunatSendResult({ success: true, cdrResponse: undefined }), 'NO_CONFIRMADO');
  assert.equal(classifySunatSendResult({ success: false, cdrResponse: undefined }), 'NO_CONFIRMADO');
  assert.equal(classifySunatSendResult({ success: false, cdrResponse: { code: '0116' } }), 'RECHAZADO');
});

test('sendSignedDocument reenvía exactamente el mismo XML firmado', async () => {
  const sentXmls = [];
  const service = Object.create(SunatService.prototype);
  service.sendBillSoap = async (_filename, base64Zip) => {
    const zip = new AdmZip(Buffer.from(base64Zip, 'base64'));
    sentXmls.push(zip.readAsText(zip.getEntries()[0]));
    return {};
  };

  const signedXml = '<Invoice><Signature Id="fixed-signature">payload</Signature></Invoice>';
  await service.sendSignedDocument(signedXml, '20600000000-03-B001-000001');
  await service.sendSignedDocument(signedXml, '20600000000-03-B001-000001');

  assert.deepEqual(sentXmls, [signedXml, signedXml]);
});
