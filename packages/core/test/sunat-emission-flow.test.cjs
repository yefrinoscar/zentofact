const assert = require('node:assert/strict');
const test = require('node:test');
const AdmZip = require('adm-zip');

const { SunatService, classifySunatSendResult } = require('../dist/services/sunat.service.js');

test('clasifica solo un CDR explícitamente aceptado como ACEPTADO', () => {
  assert.equal(classifySunatSendResult({ success: true, cdrResponse: { code: '0' } }), 'ACEPTADO');
  assert.equal(classifySunatSendResult({ success: true, cdrResponse: undefined }), 'NO_CONFIRMADO');
  assert.equal(classifySunatSendResult({ success: false, cdrResponse: undefined }), 'NO_CONFIRMADO');
  assert.equal(classifySunatSendResult({ success: false, cdrResponse: { code: '2800' } }), 'RECHAZADO');
  // Una excepción (0100-1999) no prueba que SUNAT haya procesado el número.
  assert.equal(classifySunatSendResult({ success: false, cdrResponse: { code: '0116' } }), 'NO_CONFIRMADO');
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

function cdrResponseZip(code) {
  const zip = new AdmZip();
  zip.addFile('R-20600000000-03-B001-000001.xml', Buffer.from(
    `<ar:ApplicationResponse><cac:DocumentResponse><cac:Response><cbc:ResponseCode>${code}</cbc:ResponseCode><cbc:Description>respuesta ${code}</cbc:Description></cac:Response></cac:DocumentResponse></ar:ApplicationResponse>`,
    'utf-8',
  ));
  return zip.toBuffer().toString('base64');
}

function serviceAnswering(sendBillSoap) {
  const service = Object.create(SunatService.prototype);
  service.sendBillSoap = sendBillSoap;
  return service;
}

const SIGNED = '<Invoice><Signature>fixed</Signature></Invoice>';

test('un fault 1033 de sendBill queda NO_CONFIRMADO: el número puede ser nuestro', async () => {
  const service = serviceAnswering(async () => {
    const error = new Error('El comprobante fue registrado previamente con otros datos');
    error.code = 'soap-env:Client.1033';
    throw error;
  });
  const result = await service.sendSignedDocument(SIGNED, '20600000000-03-B001-000001');
  assert.equal(result.success, false);
  assert.equal(classifySunatSendResult(result), 'NO_CONFIRMADO');
});

test('un CDR con observaciones (4xxx) es aceptación, no rechazo', async () => {
  const service = serviceAnswering(async () => ({ applicationResponse: cdrResponseZip('4252') }));
  const result = await service.sendSignedDocument(SIGNED, '20600000000-03-B001-000001');
  assert.equal(result.success, true);
  assert.equal(classifySunatSendResult(result), 'ACEPTADO');
});

test('un CDR 2xxx es rechazo definitivo y conserva el CDR como evidencia', async () => {
  const service = serviceAnswering(async () => ({ applicationResponse: cdrResponseZip('2800') }));
  const result = await service.sendSignedDocument(SIGNED, '20600000000-03-B001-000001');
  assert.equal(result.success, false);
  assert.ok(result.cdrZip);
  assert.equal(classifySunatSendResult(result), 'RECHAZADO');
});

test('una respuesta sin CDR no es aceptación', async () => {
  const service = serviceAnswering(async () => ({}));
  const result = await service.sendSignedDocument(SIGNED, '20600000000-03-B001-000001');
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'NO_CDR');
  assert.equal(classifySunatSendResult(result), 'NO_CONFIRMADO');
});
